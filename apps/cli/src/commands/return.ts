import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync } from 'fs'
import { join, dirname } from 'path'
import chalk from 'chalk'
import { hashBlob } from '@rekurn/core'
import type { Index } from '@rekurn/types'
import {
  requireRepoRoot,
  writeHEAD,
  readRef,
  writeRef,
  readIndex,
  writeIndex,
  resolveHEAD,
  readObjectFromCache,
  currentBranch,
  resolveToCommitHash,
  isResolvedIndexEntry,
  readMergeHead,
} from '../lib/repo.js'

export interface ReturnOptions {
  /** Create a new branch at the current HEAD and switch to it. */
  newBranch?: string
  /** Discard local changes without confirmation. */
  force?: boolean
}

export async function returnCommand(
  target: string | undefined,
  options: ReturnOptions,
): Promise<void> {
  const repoRoot = requireRepoRoot()
  if (readMergeHead(repoRoot)) {
    console.error(chalk.red('fatal: cannot return while a merge is in progress'))
    console.error(chalk.dim('  Resolve and commit the merge before switching commits.'))
    process.exit(1)
  }

  // -------------------------------------------------------------------------
  // rekurn return -b <new-branch>
  // Create a new branch at current HEAD and switch to it. No files change.
  // -------------------------------------------------------------------------
  if (options.newBranch) {
    const branchName = options.newBranch

    if (!isValidBranchName(branchName)) {
      console.error(chalk.red(`error: '${branchName}' is not a valid branch name`))
      process.exit(1)
    }

    const alreadyExists = readRef(repoRoot, `refs/heads/${branchName}`) !== null
    if (alreadyExists && !options.force) {
      console.error(chalk.red(`fatal: A branch named '${branchName}' already exists.`))
      console.error(chalk.dim(`  Use --force to overwrite it.`))
      process.exit(1)
    }

    const headHash = resolveHEAD(repoRoot)
    if (!headHash) {
      console.error(chalk.red('fatal: Cannot create branch — no commits yet.'))
      process.exit(1)
    }

    writeRef(repoRoot, `refs/heads/${branchName}`, headHash)
    writeHEAD(repoRoot, { type: 'symbolic', ref: `refs/heads/${branchName}` })

    console.log(`Switched to a new branch ${chalk.cyan(branchName)}`)
    return
  }

  // -------------------------------------------------------------------------
  // Require a target when -b is not given
  // -------------------------------------------------------------------------
  if (!target) {
    console.error(chalk.red('error: specify a branch name, commit hash, or use -b <name>'))
    console.error('')
    console.error(chalk.dim('  Usage:'))
    console.error(chalk.dim('    rekurn return <branch>          Switch to an existing branch'))
    console.error(chalk.dim('    rekurn return <commit-hash>     Detach HEAD at a commit'))
    console.error(chalk.dim('    rekurn return -b <name>         Create and switch to a new branch'))
    process.exit(1)
  }

  // -------------------------------------------------------------------------
  // Resolve target → full commit hash
  // -------------------------------------------------------------------------
  const targetHash = resolveToCommitHash(repoRoot, target)
  if (!targetHash) {
    console.error(chalk.red(`error: '${target}' did not match any branch, tag, or commit`))
    console.error(chalk.dim(`  Run "rekurn log" to list commits, or "rekurn branch" to list branches.`))
    process.exit(1)
  }

  // -------------------------------------------------------------------------
  // Short-circuit: already on this branch / commit
  // -------------------------------------------------------------------------
  const isBranchSwitch = readRef(repoRoot, `refs/heads/${target}`) !== null
  const currentHeadHash = resolveHEAD(repoRoot)
  const curBranch = currentBranch(repoRoot)

  if (isBranchSwitch && curBranch === target) {
    console.log(`Already on ${chalk.cyan(target)}`)
    return
  }
  if (!isBranchSwitch && currentHeadHash === targetHash) {
    console.log(chalk.yellow(`HEAD is already at ${targetHash.slice(0, 7)}`))
    return
  }

  // -------------------------------------------------------------------------
  // Safety check — abort if there are uncommitted changes (unless --force)
  // -------------------------------------------------------------------------
  if (!options.force) {
    const dirty = checkDirtyState(repoRoot, currentHeadHash)
    if (dirty) {
      console.error('')
      console.error(chalk.dim('  Commit your changes first, or use --force to discard them.'))
      process.exit(1)
    }
  }

  // -------------------------------------------------------------------------
  // Load the target commit
  // -------------------------------------------------------------------------
  const targetCommitBuf = readObjectFromCache(repoRoot, targetHash)
  if (!targetCommitBuf) {
    console.error(chalk.red(`fatal: object ${targetHash} not found in local cache`))
    console.error(chalk.dim('  (Run "rekurn fetch" to download missing objects from the remote.)'))
    process.exit(1)
  }

  const commitText = targetCommitBuf.toString('utf8')
  const treeMatch = commitText.match(/tree ([0-9a-f]{64})/)
  if (!treeMatch) {
    console.error(chalk.red(`fatal: corrupt commit object ${targetHash.slice(0, 7)}`))
    process.exit(1)
  }

  // -------------------------------------------------------------------------
  // Flatten target tree: path → { hash, mode }
  // -------------------------------------------------------------------------
  const targetFiles: Record<string, { hash: string; mode: string }> = {}
  flattenTree(repoRoot, treeMatch[1]!, '', targetFiles)

  // -------------------------------------------------------------------------
  // Apply checkout to working tree
  // -------------------------------------------------------------------------
  const currentIndex = readIndex(repoRoot)
  let filesAdded = 0
  let filesUpdated = 0
  let filesRemoved = 0

  // Delete tracked files that don't exist in the target tree
  for (const relPath of Object.keys(currentIndex)) {
    if (!(relPath in targetFiles)) {
      const fullPath = join(repoRoot, relPath)
      if (existsSync(fullPath)) {
        rmSync(fullPath)
        pruneEmptyDirs(dirname(fullPath), repoRoot)
        filesRemoved++
      }
    }
  }

  // Write or overwrite files from the target tree
  for (const [relPath, { hash }] of Object.entries(targetFiles)) {
    const content = extractBlobContent(repoRoot, hash)
    if (content === null) {
      console.warn(chalk.yellow(`warn: object ${hash.slice(0, 7)} missing for '${relPath}' — skipping`))
      continue
    }

    const fullPath = join(repoRoot, relPath)
    const existingContent = existsSync(fullPath) ? readFileSync(fullPath) : null

    mkdirSync(dirname(fullPath), { recursive: true })
    writeFileSync(fullPath, content)

    if (!existingContent) {
      filesAdded++
    } else if (!existingContent.equals(content)) {
      filesUpdated++
    }
  }

  // -------------------------------------------------------------------------
  // Rebuild the index to exactly mirror the target commit's tree
  // (clean state — no staged changes after a checkout)
  // -------------------------------------------------------------------------
  const newIndex: Index = {}
  for (const [relPath, { hash, mode }] of Object.entries(targetFiles)) {
    const fullPath = join(repoRoot, relPath)
    if (!existsSync(fullPath)) continue
    const size = statSync(fullPath).size
    newIndex[relPath] = {
      hash,
      mode: (mode === '100755' ? '100755' : '100644') as '100644' | '100755',
      size,
    }
  }
  writeIndex(repoRoot, newIndex)

  // -------------------------------------------------------------------------
  // Update HEAD
  // -------------------------------------------------------------------------
  if (isBranchSwitch) {
    writeHEAD(repoRoot, { type: 'symbolic', ref: `refs/heads/${target}` })
    console.log(`Switched to branch ${chalk.cyan(target)}`)
  } else {
    writeHEAD(repoRoot, { type: 'detached', hash: targetHash })
    const shortHash = chalk.yellow(targetHash.slice(0, 7))
    const oneliner = commitOneliner(commitText)
    console.log(`HEAD is now at ${shortHash}${oneliner ? ` ${oneliner}` : ''}`)
    console.log('')
    console.log(chalk.yellow('You are in detached HEAD state.'))
    console.log(chalk.dim('  Changes you commit here are not on any branch.'))
    console.log(chalk.dim('  To save your work: rekurn return -b <new-branch>'))
  }

  // Summary of working-tree changes
  const parts: string[] = []
  if (filesAdded) parts.push(chalk.green(`${filesAdded} added`))
  if (filesUpdated) parts.push(chalk.yellow(`${filesUpdated} updated`))
  if (filesRemoved) parts.push(chalk.red(`${filesRemoved} removed`))
  if (parts.length) {
    console.log(chalk.dim(`  Working tree: ${parts.join(', ')}`))
  }
}

// ---------------------------------------------------------------------------
// Dirty-state check
// ---------------------------------------------------------------------------

/**
 * Returns true if the working tree has uncommitted changes (either staged
 * or unstaged). Prints a specific error message for each kind.
 */
function checkDirtyState(repoRoot: string, currentHeadHash: string | null): boolean {
  const index = readIndex(repoRoot)
  let dirty = false

  // ----- Staged changes (index differs from HEAD tree) --------------------
  const headTree: Record<string, string> = {}

  if (currentHeadHash) {
    const commitBuf = readObjectFromCache(repoRoot, currentHeadHash)
    if (commitBuf) {
      const treeMatch = commitBuf.toString('utf8').match(/tree ([0-9a-f]{64})/)
      if (treeMatch) {
        const treeFiles: Record<string, { hash: string; mode: string }> = {}
        flattenTree(repoRoot, treeMatch[1]!, '', treeFiles)
        for (const [p, { hash }] of Object.entries(treeFiles)) {
          headTree[p] = hash
        }
      }
    }
  }

  for (const [path, entry] of Object.entries(index)) {
    if (!isResolvedIndexEntry(entry)) {
      console.error(chalk.red(`error: unresolved conflict in '${path}'`))
      dirty = true
      break
    }
    if (!(path in headTree) || headTree[path] !== entry.hash) {
      console.error(chalk.red(`error: Your staged changes to '${path}' would be overwritten.`))
      dirty = true
      break
    }
  }

  if (!dirty) {
    for (const path of Object.keys(headTree)) {
      if (!(path in index)) {
        console.error(chalk.red(`error: Your local changes to '${path}' would be overwritten.`))
        dirty = true
        break
      }
    }
  }

  // ----- Unstaged changes (working tree differs from index) ---------------
  if (!dirty) {
    for (const [relPath, entry] of Object.entries(index)) {
      if (!isResolvedIndexEntry(entry)) continue
      const fullPath = join(repoRoot, relPath)

      if (!existsSync(fullPath)) {
        console.error(chalk.red(`error: '${relPath}' deleted locally — changes would be lost.`))
        dirty = true
        break
      }

      const content = readFileSync(fullPath)
      if (hashBlob(content) !== entry.hash) {
        console.error(chalk.red(`error: Your local changes to '${relPath}' would be overwritten.`))
        dirty = true
        break
      }
    }
  }

  return dirty
}

// ---------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------

/**
 * Recursively flatten a tree object into a flat map of relative path →
 * { hash, mode }.  Synchronous — all objects must be in the local cache.
 */
function flattenTree(
  repoRoot: string,
  treeHash: string,
  prefix: string,
  acc: Record<string, { hash: string; mode: string }>,
): void {
  const buf = readObjectFromCache(repoRoot, treeHash)
  if (!buf) return

  const raw = buf.toString('utf8')
  const jsonStart = raw.indexOf('{')
  if (jsonStart === -1) return

  const treeObj = JSON.parse(raw.slice(jsonStart)) as {
    entries: Array<{ mode: string; name: string; hash: string }>
  }

  for (const entry of treeObj.entries) {
    const entryPath = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.mode === '040000') {
      flattenTree(repoRoot, entry.hash, entryPath, acc)
    } else {
      acc[entryPath] = { hash: entry.hash, mode: entry.mode }
    }
  }
}

// ---------------------------------------------------------------------------
// Blob extraction
// ---------------------------------------------------------------------------

/**
 * Read a blob from the object cache and return its raw file content (without
 * the "rekurn-blob\n<size>\n" header).  Returns null if the object is missing.
 */
function extractBlobContent(repoRoot: string, blobHash: string): Buffer | null {
  const buf = readObjectFromCache(repoRoot, blobHash)
  if (!buf) return null

  // Header format: "rekurn-blob\n<size>\n"
  const first = buf.indexOf(0x0a)         // first newline after "rekurn-blob"
  if (first === -1) return null
  const second = buf.indexOf(0x0a, first + 1)  // second newline after size
  if (second === -1) return null

  return buf.slice(second + 1)
}

// ---------------------------------------------------------------------------
// Working-tree utilities
// ---------------------------------------------------------------------------

/**
 * Walk up from `dir` toward `repoRoot`, removing directories that become
 * empty as a result of the checkout.  Stops at repoRoot to avoid accidents.
 */
function pruneEmptyDirs(dir: string, repoRoot: string): void {
  if (dir === repoRoot || !dir.startsWith(repoRoot)) return
  try {
    const entries = readdirSync(dir)
    if (entries.length === 0) {
      rmSync(dir)
      pruneEmptyDirs(dirname(dir), repoRoot)
    }
  } catch {
    // Directory might have already been removed, or we lack permission — skip
  }
}

// ---------------------------------------------------------------------------
// Branch name validation
// ---------------------------------------------------------------------------

function isValidBranchName(name: string): boolean {
  // Reject names with path separators, spaces, or shell metacharacters.
  // Allow: letters, digits, hyphens, underscores, dots, forward slashes (namespace branches)
  return /^[a-zA-Z0-9_][a-zA-Z0-9_./-]*$/.test(name) && !name.includes('..')
}

// ---------------------------------------------------------------------------
// Commit one-liner (for detached HEAD message)
// ---------------------------------------------------------------------------

function commitOneliner(rawCommitText: string): string {
  // The message starts after a blank line in the body
  const blankLine = rawCommitText.indexOf('\n\n')
  if (blankLine === -1) return ''
  const msg = rawCommitText.slice(blankLine + 2).trimStart()
  return msg.split('\n')[0]?.trim() ?? ''
}
