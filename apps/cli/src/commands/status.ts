import { existsSync, readdirSync, readFileSync } from 'fs'
import { join, relative } from 'path'
import { hashBlob } from '@rekurn/core'
import {
  requireRepoRoot,
  readIndex,
  readObjectFromCache,
  resolveHEAD,
  currentBranch,
  isConflictIndexEntry,
  isResolvedIndexEntry,
  readMergeHead,
} from '../lib/repo.js'
import { buildIgnoreMatcher } from '../lib/ignore.js'
import { printStatus, type StatusEntry } from '../lib/format.js'

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
  const workingTree = collectWorkingTree(repoRoot, shouldIgnore)

  for (const filePath of workingTree) {
    const relPath = relative(repoRoot, filePath)
    const indexEntry = index[relPath]

    if (!indexEntry) {
      untracked.push(relPath)
    } else if (isConflictIndexEntry(indexEntry)) {
      continue
    } else {
      // Re-hash the file to see if it has changed since staging
      const content = readFileSync(filePath)
      const currentHash = hashBlob(content)
      if (currentHash !== indexEntry.hash) {
        unstaged.push({ path: relPath, status: 'modified' })
      }
    }
  }

  // Files in index but deleted from working tree
  for (const relPath of Object.keys(index)) {
    const entry = index[relPath]
    if (!entry || isConflictIndexEntry(entry)) continue
    const fullPath = join(repoRoot, relPath)
    if (!existsSync(fullPath)) {
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
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function buildHeadTreeMap(repoRoot: string): Promise<Record<string, string>> {
  const headHash = resolveHEAD(repoRoot)
  if (!headHash) return {}

  const commitBuf = readObjectFromCache(repoRoot, headHash)
  if (!commitBuf) return {}

  // Parse the tree hash from the commit body
  const commitText = commitBuf.toString('utf8')
  const treeMatch = commitText.match(/tree ([0-9a-f]{64})/)
  if (!treeMatch) return {}

  const treeHash = treeMatch[1]!
  const treeMap: Record<string, string> = {}
  await flattenTree(repoRoot, treeHash, '', treeMap)
  return treeMap
}

async function flattenTree(
  repoRoot: string,
  treeHash: string,
  prefix: string,
  acc: Record<string, string>,
): Promise<void> {
  const treeBuf = readObjectFromCache(repoRoot, treeHash)
  if (!treeBuf) return

  // Parse the tree JSON
  const raw = treeBuf.toString('utf8')
  const jsonStart = raw.indexOf('{')
  if (jsonStart === -1) return

  const treeObj = JSON.parse(raw.slice(jsonStart)) as {
    type: string
    entries: Array<{ mode: string; name: string; hash: string }>
  }

  for (const entry of treeObj.entries) {
    const entryPath = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.mode === '040000') {
      await flattenTree(repoRoot, entry.hash, entryPath, acc)
    } else {
      acc[entryPath] = entry.hash
    }
  }
}

function collectWorkingTree(
  repoRoot: string,
  shouldIgnore: (rel: string) => boolean,
): string[] {
  const results: string[] = []
  walkDir(repoRoot, repoRoot, shouldIgnore, results)
  return results
}

function walkDir(
  dir: string,
  repoRoot: string,
  shouldIgnore: (rel: string) => boolean,
  acc: string[],
): void {
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    const rel = relative(repoRoot, fullPath)
    if (shouldIgnore(rel)) continue

    if (entry.isDirectory()) {
      walkDir(fullPath, repoRoot, shouldIgnore, acc)
    } else if (entry.isFile()) {
      acc.push(fullPath)
    }
  }
}
