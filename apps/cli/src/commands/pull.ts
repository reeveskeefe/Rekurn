/**
 * rekurn pull
 *
 * Fetches remote objects then fast-forwards the current local branch.
 *
 * Flow:
 *   1. Run fetch.
 *   2. Read the remote-tracking ref for the current branch.
 *   3. If local hash matches remote hash → already up to date.
 *   4. Otherwise fast-forward local branch to remote hash + checkout files.
 */

import chalk from 'chalk'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { parseCommit, parseTree } from '@rekurn/core'
import { loadCredentials } from '../lib/credentials.js'
import {
  requireRepoRoot,
  currentBranch,
  resolveHEAD,
  readRef,
  writeRef,
  readObjectFromCache,
  writeIndex,
} from '../lib/repo.js'
import { getRemote } from '../lib/remote.js'
import { fetchCommand } from './fetch.js'
import type { Index } from '@rekurn/types'

// ---------------------------------------------------------------------------
// Inline checkout helpers (same logic as rekurn return)
// ---------------------------------------------------------------------------

function extractBlobContent(bytes: Buffer): Buffer {
  // Format: "rekurn-blob\n<size>\n<content>"
  const blobPrefix = Buffer.from('rekurn-blob\n')
  const afterPrefix = bytes.slice(blobPrefix.length)
  const nlIdx = afterPrefix.indexOf(0x0a)
  return afterPrefix.slice(nlIdx + 1)
}

function flattenTree(
  repoRoot: string,
  treeHash: string,
  prefix: string,
  acc: Record<string, { hash: string; mode: string }>,
): void {
  const bytes = readObjectFromCache(repoRoot, treeHash)
  if (!bytes) return
  const tree = parseTree(bytes)
  for (const entry of tree.entries) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.mode === '040000') {
      flattenTree(repoRoot, entry.hash, path, acc)
    } else {
      acc[path] = { hash: entry.hash, mode: entry.mode }
    }
  }
}

function checkoutCommit(repoRoot: string, commitHash: string): { fileCount: number } {
  const commitBytes = readObjectFromCache(repoRoot, commitHash)
  if (!commitBytes) throw new Error(`Commit ${commitHash.slice(0, 12)}… not in local cache`)

  const commit = parseCommit(commitBytes)
  const files: Record<string, { hash: string; mode: string }> = {}
  flattenTree(repoRoot, commit.treeHash, '', files)

  const index: Index = {}
  let fileCount = 0

  for (const [relPath, { hash, mode }] of Object.entries(files)) {
    const blobBytes = readObjectFromCache(repoRoot, hash)
    if (!blobBytes) continue
    const content = extractBlobContent(blobBytes)
    const fullPath = join(repoRoot, relPath)
    mkdirSync(dirname(fullPath), { recursive: true })
    writeFileSync(fullPath, content)
    index[relPath] = { hash, mode: mode === '100755' ? '100755' : '100644', size: content.length }
    fileCount++
  }

  writeIndex(repoRoot, index)
  return { fileCount }
}

// ---------------------------------------------------------------------------
// Pull command
// ---------------------------------------------------------------------------

export async function pullCommand(): Promise<void> {
  const repoRoot = requireRepoRoot()

  const creds = loadCredentials()
  if (!creds) {
    console.error(chalk.red('Not logged in. Run "rekurn login" first.'))
    process.exit(1)
  }

  const remote = getRemote(repoRoot)
  if (!remote) {
    console.error(chalk.red('No remote configured.'))
    process.exit(1)
  }

  // ----- Fetch -----
  await fetchCommand()

  // ----- Determine local and remote hashes for current branch -----
  const branch = currentBranch(repoRoot) ?? 'main'
  const localHash = resolveHEAD(repoRoot)
  const remoteTrackingHash = readRef(repoRoot, `refs/remotes/origin/${branch}`)

  if (!remoteTrackingHash) {
    console.log(chalk.yellow(`No tracking ref for origin/${branch}.`))
    return
  }

  if (localHash === remoteTrackingHash) {
    console.log('Already up to date.')
    return
  }

  // ----- Fast-forward -----
  console.log(
    chalk.dim(
      `Updating ${(localHash ?? '').slice(0, 7)}..${remoteTrackingHash.slice(0, 7)}`,
    ),
  )

  try {
    const { fileCount } = checkoutCommit(repoRoot, remoteTrackingHash)
    writeRef(repoRoot, `refs/heads/${branch}`, remoteTrackingHash)
    console.log(chalk.green(`Fast-forward: ${fileCount} file(s) updated.`))
  } catch (err) {
    console.error(chalk.red('Checkout failed:'), err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}
