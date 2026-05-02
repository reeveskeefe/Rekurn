import chalk from 'chalk'
import { createCommit, buildTreeFromPaths, serializeTree, serializeCommit } from '@rekurn/core'
import type { CommitData, Index } from '@rekurn/types'
import {
  requireRepoRoot,
  readIndex,
  writeIndex,
  resolveHEAD,
  readHEAD,
  writeRef,
  writeObjectToCache,
  resolveIdentity,
  currentBranch,
  isConflictIndexEntry,
  readMergeHead,
  readMergeMessage,
  clearMergeState,
} from '../lib/repo.js'

export interface CommitOptions {
  message?: string
  amend?: boolean
  noSign?: boolean
}

export async function commitCommand(options: CommitOptions): Promise<void> {
  const repoRoot = requireRepoRoot()
  const index = readIndex(repoRoot)

  if (Object.keys(index).length === 0) {
    console.log('Nothing to commit (staging area is empty).')
    console.log(chalk.dim('  Use "rekurn add <file>..." to stage changes.'))
    return
  }

  const conflicts = Object.entries(index)
    .filter(([, entry]) => isConflictIndexEntry(entry))
    .map(([path]) => path)
  if (conflicts.length > 0) {
    console.error(chalk.red('error: cannot commit while merge conflicts remain'))
    for (const path of conflicts) console.error(chalk.dim(`  ${path}`))
    console.error(chalk.dim('  Resolve conflicts, then run "rekurn add <file>..." before committing.'))
    process.exit(1)
  }

  // Resolve identity
  const identity = resolveIdentity(repoRoot)
  if (!identity) {
    console.error(chalk.red('error: author identity unknown'))
    console.error('')
    console.error('  Please configure your identity:')
    console.error(chalk.dim('    rekurn config user.name "Your Name"'))
    console.error(chalk.dim('    rekurn config user.email "you@example.com"'))
    process.exit(1)
  }

  // Require a commit message
  const message = (options.message ?? readMergeMessage(repoRoot) ?? '').trim()
  if (!message) {
    console.error(chalk.red('error: commit message cannot be empty'))
    console.error(chalk.dim('  Use: rekurn commit -m "your message"'))
    process.exit(1)
  }

  // Build tree from the staging index
  const flatEntries = Object.entries(index)
    .flatMap(([path, entry]) => (
      isConflictIndexEntry(entry)
        ? []
        : [{ path, hash: entry.hash, mode: entry.mode }]
    ))

  const { rootTree, allTrees } = buildTreeFromPaths(flatEntries)

  // Write all tree objects to the cache
  for (const tree of allTrees) {
    writeObjectToCache(repoRoot, tree.hash, serializeTree(tree))
  }

  // Determine parent commit(s)
  const parentHash = resolveHEAD(repoRoot)
  const parentHashes = parentHash ? [parentHash] : []
  const mergeHead = readMergeHead(repoRoot)
  if (mergeHead && parentHash && mergeHead !== parentHash) parentHashes.push(mergeHead)

  // Build commit data
  const now = Math.floor(Date.now() / 1000)
  const commitData: CommitData = {
    treeHash: rootTree.hash,
    parentHashes,
    author: { name: identity.name, email: identity.email, timestamp: now },
    committer: { name: identity.name, email: identity.email, timestamp: now },
    message,
  }

  const commit = createCommit(commitData)
  writeObjectToCache(repoRoot, commit.hash, serializeCommit(commit))

  // Advance the current branch ref to the new commit
  const head = readHEAD(repoRoot)
  if (head.type === 'symbolic') {
    writeRef(repoRoot, head.ref, commit.hash)
  } else {
    // Detached HEAD — update HEAD directly
    const { writeHEAD } = await import('../lib/repo.js')
    writeHEAD(repoRoot, { type: 'detached', hash: commit.hash })
  }

  // Keep the index as the tracked-file baseline for the committed tree.
  const committedIndex: Index = {}
  for (const { path } of flatEntries) {
    const entry = index[path]
    if (entry && !isConflictIndexEntry(entry)) committedIndex[path] = entry
  }
  writeIndex(repoRoot, committedIndex)
  clearMergeState(repoRoot)

  // Print summary
  const branch = currentBranch(repoRoot)
  const isRoot = parentHashes.length === 0
  const branchLabel = branch ? chalk.cyan(branch) : chalk.yellow('(detached HEAD)')
  const rootLabel = isRoot ? chalk.dim(' (root-commit)') : ''
  const shortHash = chalk.yellow(commit.hash.slice(0, 7))
  const fileCount = flatEntries.length

  console.log(
    `[${branchLabel}${rootLabel} ${shortHash}] ${message.split('\n')[0]}`,
  )
  console.log(` ${fileCount} file${fileCount !== 1 ? 's' : ''} committed`)
}
