import { existsSync } from 'fs'
import { stat } from 'fs/promises'
import { join, relative } from 'path'
import {
  requireRepoRoot,
  readIndex,
  resolveHEAD,
  currentBranch,
  isConflictIndexEntry,
  isResolvedIndexEntry,
  readMergeHead,
  flattenCommitTree,
} from '../lib/repo.js'
import { buildIgnoreMatcher } from '../lib/ignore.js'
import { printStatus, type StatusEntry } from '../lib/format.js'
import { defaultFileConcurrency } from '../lib/concurrency.js'
import { hashFileAsBlob, walkFilePaths } from '../lib/file-objects.js'

export async function statusCommand(): Promise<void> {
  const repoRoot = requireRepoRoot()
  const index = readIndex(repoRoot)
  const shouldIgnore = buildIgnoreMatcher(repoRoot)
  const conflicts = Object.entries(index)
    .filter(([, entry]) => isConflictIndexEntry(entry))
    .map(([path]) => path)

  // -------------------------------------------------------------------------
  // Build HEAD tree map  (path → hash)
  // -------------------------------------------------------------------------
  const headTree = await buildHeadTreeMap(repoRoot)

  // -------------------------------------------------------------------------
  // Staged changes  (index vs HEAD tree)
  // -------------------------------------------------------------------------
  const staged: StatusEntry[] = []

  for (const [path, entry] of Object.entries(index)) {
    if (!isResolvedIndexEntry(entry)) continue
    if (!(path in headTree)) {
      staged.push({ path, status: 'added' })
    } else if (headTree[path] !== entry.hash) {
      staged.push({ path, status: 'modified' })
    }
  }

  for (const path of Object.keys(headTree)) {
    if (!(path in index)) {
      staged.push({ path, status: 'deleted' })
    }
  }

  staged.sort((a, b) => a.path.localeCompare(b.path))

  // -------------------------------------------------------------------------
  // Unstaged changes  (working tree vs index)
  // -------------------------------------------------------------------------
  const unstaged: StatusEntry[] = []
  const untracked: string[] = []
  const seen = new Set<string>()
  const pending = new Set<Promise<void>>()
  const concurrency = defaultFileConcurrency()

  for await (const filePath of walkFilePaths(repoRoot, repoRoot, shouldIgnore)) {
    let task!: Promise<void>
    task = inspectWorkingFile(filePath).finally(() => pending.delete(task))
    pending.add(task)

    if (pending.size >= concurrency) {
      await Promise.race(pending)
    }
  }

  await Promise.all(pending)

  // Files in index but deleted from working tree
  for (const relPath of Object.keys(index)) {
    const entry = index[relPath]
    if (!entry || isConflictIndexEntry(entry)) continue
    if (!seen.has(relPath) && !existsSync(join(repoRoot, relPath))) {
      unstaged.push({ path: relPath, status: 'deleted' })
    }
  }

  unstaged.sort((a, b) => a.path.localeCompare(b.path))
  untracked.sort()

  // -------------------------------------------------------------------------
  // Print
  // -------------------------------------------------------------------------
  const branch = currentBranch(repoRoot)
  printStatus(branch, staged, unstaged, untracked, {
    mergeHead: readMergeHead(repoRoot),
    conflicts,
  })

  async function inspectWorkingFile(filePath: string): Promise<void> {
    const relPath = relative(repoRoot, filePath)
    seen.add(relPath)
    const indexEntry = index[relPath]

    if (!indexEntry) {
      untracked.push(relPath)
    } else if (isConflictIndexEntry(indexEntry)) {
      return
    } else {
      const stats = await stat(filePath)
      if (stats.size !== indexEntry.size) {
        unstaged.push({ path: relPath, status: 'modified' })
        return
      }

      const currentHash = await hashFileAsBlob(filePath, stats.size)
      if (currentHash !== indexEntry.hash) {
        unstaged.push({ path: relPath, status: 'modified' })
      }
    }
  }
}

function buildHeadTreeMap(repoRoot: string): Record<string, string> {
  const headHash = resolveHEAD(repoRoot)
  if (!headHash) return {}

  const entries = flattenCommitTree(repoRoot, headHash)
  if (!entries) return {}

  const map: Record<string, string> = {}
  for (const [path, entry] of Object.entries(entries)) map[path] = entry.hash
  return map
}
