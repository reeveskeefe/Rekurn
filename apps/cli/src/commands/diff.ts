import { existsSync, readFileSync } from 'fs'
import { stat } from 'fs/promises'
import { join } from 'path'
import chalk from 'chalk'
import { opaqueFileDiff, unifiedDiff } from '@rekurn/diff'
import {
  requireRepoRoot,
  readIndex,
  readObjectFromCache,
  resolveHEAD,
  isResolvedIndexEntry,
  flattenCommitTree,
} from '../lib/repo.js'
import { printDiff } from '../lib/format.js'
import { hashFileAsBlob } from '../lib/file-objects.js'

const MAX_TEXT_DIFF_BYTES = 4 * 1024 * 1024

export interface DiffOptions {
  staged?: boolean
  paths?: string[]
}

export async function diffCommand(options: DiffOptions): Promise<void> {
  const repoRoot = requireRepoRoot()
  const index = readIndex(repoRoot)

  if (options.staged) {
    // Staged diff: index vs HEAD tree
    await diffStagedVsHead(repoRoot, resolvedIndex(index))
  } else {
    // Working tree diff: working files vs index
    await diffWorkingVsIndex(repoRoot, resolvedIndex(index))
  }
}

// ---------------------------------------------------------------------------
// Staged diff  (what would be committed)
// ---------------------------------------------------------------------------

async function diffStagedVsHead(
  repoRoot: string,
  index: Record<string, { hash: string; mode: string; size: number }>,
): Promise<void> {
  const headTree = buildHeadTreeMap(repoRoot)
  let hasDiff = false

  const allPaths = new Set([...Object.keys(index), ...Object.keys(headTree)])

  for (const relPath of [...allPaths].sort()) {
    const indexEntry = index[relPath]
    const headHash = headTree[relPath]

    if (!indexEntry && headHash) {
      // Deleted in staged
      const oldContent = readBlobFromCache(repoRoot, headHash)
      const diff = unifiedDiff(oldContent, '', relPath, relPath)
      printDiff(diff)
      hasDiff = true
    } else if (indexEntry && !headHash) {
      // New file in staged
      if (indexEntry.size > MAX_TEXT_DIFF_BYTES) {
        printDiff(opaqueFileDiff(relPath, relPath, 'Large file differs; text diff omitted.'))
        hasDiff = true
        continue
      }
      const newContent = readBlobContent(repoRoot, relPath, indexEntry.hash)
      const diff = unifiedDiff('', newContent, relPath, relPath)
      printDiff(diff)
      hasDiff = true
    } else if (indexEntry && headHash && indexEntry.hash !== headHash) {
      // Modified in staged
      if (indexEntry.size > MAX_TEXT_DIFF_BYTES) {
        printDiff(opaqueFileDiff(relPath, relPath, 'Large file differs; text diff omitted.'))
        hasDiff = true
        continue
      }
      const oldContent = readBlobFromCache(repoRoot, headHash)
      const newContent = readBlobContent(repoRoot, relPath, indexEntry.hash)
      const diff = unifiedDiff(oldContent, newContent, relPath, relPath)
      printDiff(diff)
      hasDiff = true
    }
  }

  if (!hasDiff) {
    console.log(chalk.dim('No staged changes.'))
  }
}

// ---------------------------------------------------------------------------
// Working tree diff  (unstaged changes)
// ---------------------------------------------------------------------------

async function diffWorkingVsIndex(
  repoRoot: string,
  index: Record<string, { hash: string; mode: string; size: number }>,
): Promise<void> {
  let hasDiff = false

  for (const [relPath, entry] of Object.entries(index)) {
    const fullPath = join(repoRoot, relPath)

    if (!existsSync(fullPath)) {
      // File deleted from working tree
      const oldContent = readBlobContent(repoRoot, relPath, entry.hash)
      const diff = unifiedDiff(oldContent, '', relPath, relPath)
      printDiff(diff)
      hasDiff = true
      continue
    }

    const stats = await stat(fullPath)
    const currentHash = stats.size === entry.size
      ? await hashFileAsBlob(fullPath, stats.size)
      : null

    if (currentHash !== entry.hash) {
      if (entry.size + stats.size > MAX_TEXT_DIFF_BYTES) {
        printDiff(opaqueFileDiff(relPath, relPath, 'Large file differs; text diff omitted.'))
        hasDiff = true
        continue
      }

      const oldContent = readBlobContent(repoRoot, relPath, entry.hash)
      const newContent = readFileSync(fullPath, 'utf8')
      const diff = unifiedDiff(oldContent, newContent, relPath, relPath)
      printDiff(diff)
      hasDiff = true
    }
  }

  if (!hasDiff) {
    console.log(chalk.dim('No unstaged changes.'))
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readBlobContent(repoRoot: string, _relPath: string, hash: string): string {
  return readBlobFromCache(repoRoot, hash)
}

function resolvedIndex(
  index: ReturnType<typeof readIndex>,
): Record<string, { hash: string; mode: string; size: number }> {
  const resolved: Record<string, { hash: string; mode: string; size: number }> = {}
  for (const [path, entry] of Object.entries(index)) {
    if (isResolvedIndexEntry(entry)) resolved[path] = entry
  }
  return resolved
}

function readBlobFromCache(repoRoot: string, hash: string): string {
  const buf = readObjectFromCache(repoRoot, hash)
  if (!buf) return ''
  // Blob format: "rekurn-blob\n<size>\n<content>"
  const headerEnd = buf.indexOf('\n', buf.indexOf('\n') + 1)
  if (headerEnd === -1) return buf.toString('utf8')
  return buf.slice(headerEnd + 1).toString('utf8')
}

function buildHeadTreeMap(repoRoot: string): Record<string, string> {
  const headHash = resolveHEAD(repoRoot)
  if (!headHash) return {}

  const entries = flattenCommitTree(repoRoot, headHash)
  if (!entries) return {}

  const treeMap: Record<string, string> = {}
  for (const [path, entry] of Object.entries(entries)) treeMap[path] = entry.hash
  return treeMap
}
