import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import chalk from 'chalk'
import { hashBlob } from '@rekurn/core'
import { unifiedDiff } from '@rekurn/diff'
import {
  requireRepoRoot,
  readIndex,
  readObjectFromCache,
  resolveHEAD,
  isResolvedIndexEntry,
} from '../lib/repo.js'
import { printDiff } from '../lib/format.js'

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
    diffWorkingVsIndex(repoRoot, resolvedIndex(index))
  }
}

// ---------------------------------------------------------------------------
// Staged diff  (what would be committed)
// ---------------------------------------------------------------------------

async function diffStagedVsHead(
  repoRoot: string,
  index: Record<string, { hash: string; mode: string; size: number }>,
): Promise<void> {
  const headTree = await buildHeadTreeMap(repoRoot)
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
      const newContent = readBlobContent(repoRoot, relPath, indexEntry.hash)
      const diff = unifiedDiff('', newContent, relPath, relPath)
      printDiff(diff)
      hasDiff = true
    } else if (indexEntry && headHash && indexEntry.hash !== headHash) {
      // Modified in staged
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

function diffWorkingVsIndex(
  repoRoot: string,
  index: Record<string, { hash: string; mode: string; size: number }>,
): void {
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

    const currentContent = readFileSync(fullPath)
    const currentHash = hashBlob(currentContent)

    if (currentHash !== entry.hash) {
      const oldContent = readBlobContent(repoRoot, relPath, entry.hash)
      const newContent = currentContent.toString('utf8')
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

async function buildHeadTreeMap(repoRoot: string): Promise<Record<string, string>> {
  const headHash = resolveHEAD(repoRoot)
  if (!headHash) return {}

  const commitBuf = readObjectFromCache(repoRoot, headHash)
  if (!commitBuf) return {}

  const commitText = commitBuf.toString('utf8')
  const treeMatch = commitText.match(/tree ([0-9a-f]{64})/)
  if (!treeMatch) return {}

  const treeMap: Record<string, string> = {}
  await flattenTree(repoRoot, treeMatch[1]!, '', treeMap)
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

  const raw = treeBuf.toString('utf8')
  const jsonStart = raw.indexOf('{')
  if (jsonStart === -1) return

  const treeObj = JSON.parse(raw.slice(jsonStart)) as {
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
