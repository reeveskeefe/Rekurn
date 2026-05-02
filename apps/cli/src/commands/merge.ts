import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import chalk from 'chalk'
import { createBlob, createCommit, serializeBlob, serializeCommit, serializeTree, buildTreeFromPaths } from '@rekurn/core'
import { threeWayMerge, type MergeFileEntry } from '@rekurn/diff'
import type { CommitData, Index } from '@rekurn/types'
import {
  currentBranch,
  extractBlobContent,
  flattenCommitTree,
  isResolvedIndexEntry,
  readCommitFromCache,
  readHEAD,
  readIndex,
  readMergeHead,
  requireRepoRoot,
  resolveHEAD,
  resolveIdentity,
  resolveToCommitHash,
  writeIndex,
  writeMergeHead,
  writeMergeMessage,
  writeObjectToCache,
  writeRef,
} from '../lib/repo.js'
import { hashFileAsBlob } from '../lib/file-objects.js'

export async function mergeCommand(branchOrCommit: string): Promise<void> {
  const repoRoot = requireRepoRoot()
  const oursHash = resolveHEAD(repoRoot)
  if (!oursHash) {
    console.error(chalk.red('fatal: cannot merge into an unborn branch'))
    process.exit(1)
  }

  if (readMergeHead(repoRoot)) {
    console.error(chalk.red('fatal: You have not concluded your merge.'))
    console.error(chalk.dim('  Resolve conflicts and commit, or remove the merge state before retrying.'))
    process.exit(1)
  }

  await assertCleanWorkingTree(repoRoot)

  const theirsHash = resolveToCommitHash(repoRoot, branchOrCommit)
  if (!theirsHash) {
    console.error(chalk.red(`fatal: '${branchOrCommit}' does not point to a commit`))
    process.exit(1)
  }

  if (theirsHash === oursHash) {
    console.log('Already up to date.')
    return
  }

  if (isAncestor(repoRoot, theirsHash, oursHash)) {
    console.log('Already up to date.')
    return
  }

  if (isAncestor(repoRoot, oursHash, theirsHash)) {
    fastForward(repoRoot, theirsHash)
    return
  }

  const baseHash = findMergeBase(repoRoot, oursHash, theirsHash)
  if (!baseHash) {
    console.error(chalk.red('fatal: refusing to merge unrelated histories'))
    process.exit(1)
  }

  const base = loadMergeMap(repoRoot, baseHash)
  const ours = loadMergeMap(repoRoot, oursHash)
  const theirs = loadMergeMap(repoRoot, theirsHash)
  const result = threeWayMerge(base, ours, theirs, {
    ours: 'HEAD',
    theirs: branchOrCommit,
  })

  const newIndex = writeMergeResult(repoRoot, result.files, result.conflicts)
  writeIndex(repoRoot, newIndex)

  const branch = currentBranch(repoRoot) ?? 'HEAD'
  const message = `Merge branch '${branchOrCommit}' into ${branch}`

  if (result.conflicts.length > 0) {
    writeMergeHead(repoRoot, theirsHash)
    writeMergeMessage(repoRoot, message)
    console.error(chalk.red(`Automatic merge failed; ${result.conflicts.length} conflict${result.conflicts.length === 1 ? '' : 's'} need resolution.`))
    for (const conflict of result.conflicts) console.error(chalk.dim(`  ${conflict.path}`))
    console.error(chalk.dim('  Fix the files, run "rekurn add <file>...", then "rekurn commit".'))
    process.exit(1)
  }

  const commitHash = createMergeCommit(repoRoot, oursHash, theirsHash, message, newIndex)
  console.log(`Merge made by the three-way strategy ${chalk.yellow(commitHash.slice(0, 7))}.`)
}

async function assertCleanWorkingTree(repoRoot: string): Promise<void> {
  const index = readIndex(repoRoot)
  for (const [path, entry] of Object.entries(index)) {
    if (!isResolvedIndexEntry(entry)) {
      console.error(chalk.red(`fatal: unresolved conflict in '${path}'`))
      process.exit(1)
    }

    const fullPath = join(repoRoot, path)
    if (!existsSync(fullPath)) {
      console.error(chalk.red(`fatal: local deletion of '${path}' would be overwritten by merge`))
      process.exit(1)
    }

    const stats = statSync(fullPath)
    if (stats.size !== entry.size) {
      console.error(chalk.red(`fatal: local changes to '${path}' would be overwritten by merge`))
      process.exit(1)
    }

    const currentHash = await hashFileAsBlob(fullPath, stats.size)
    if (currentHash !== entry.hash) {
      console.error(chalk.red(`fatal: local changes to '${path}' would be overwritten by merge`))
      process.exit(1)
    }
  }
}

function fastForward(repoRoot: string, targetHash: string): void {
  const files = flattenCommitTree(repoRoot, targetHash)
  if (!files) {
    console.error(chalk.red(`fatal: cannot read target tree ${targetHash.slice(0, 7)}`))
    process.exit(1)
  }

  const index = checkoutFiles(repoRoot, new Map(Object.entries(files).map(([path, entry]) => {
    return [path, {
      path,
      hash: entry.hash,
      mode: entry.mode as MergeFileEntry['mode'],
      content: lazyBlobContent(repoRoot, path, entry.hash),
    }]
  })))

  writeIndex(repoRoot, index)
  const head = readHEAD(repoRoot)
  if (head.type === 'symbolic') writeRef(repoRoot, head.ref, targetHash)
  console.log(`Fast-forwarded to ${chalk.yellow(targetHash.slice(0, 7))}.`)
}

function loadMergeMap(repoRoot: string, commitHash: string): Map<string, MergeFileEntry> {
  const tree = flattenCommitTree(repoRoot, commitHash)
  if (!tree) {
    console.error(chalk.red(`fatal: cannot read tree for ${commitHash.slice(0, 7)}`))
    process.exit(1)
  }

  const map = new Map<string, MergeFileEntry>()
  for (const [path, entry] of Object.entries(tree)) {
    map.set(path, {
      path,
      hash: entry.hash,
      mode: entry.mode as MergeFileEntry['mode'],
      content: lazyBlobContent(repoRoot, path, entry.hash),
    })
  }
  return map
}

function writeMergeResult(
  repoRoot: string,
  files: Map<string, MergeFileEntry>,
  conflicts: Array<{ path: string; base?: MergeFileEntry; ours?: MergeFileEntry; theirs?: MergeFileEntry }>,
): Index {
  const conflictPaths = new Set(conflicts.map((conflict) => conflict.path))
  const index = checkoutFiles(repoRoot, files, conflictPaths)

  for (const conflict of conflicts) {
    index[conflict.path] = {
      conflict: true,
      mode: (conflict.ours?.mode ?? conflict.theirs?.mode ?? '100644') as '100644' | '100755',
      ...(conflict.base ? { baseHash: conflict.base.hash } : {}),
      ...(conflict.ours ? { oursHash: conflict.ours.hash } : {}),
      ...(conflict.theirs ? { theirsHash: conflict.theirs.hash } : {}),
    }
  }

  return index
}

function checkoutFiles(
  repoRoot: string,
  files: Map<string, MergeFileEntry>,
  conflicted = new Set<string>(),
): Index {
  const previous = readIndex(repoRoot)
  for (const path of Object.keys(previous)) {
    if (!files.has(path)) {
      const fullPath = join(repoRoot, path)
      if (existsSync(fullPath)) rmSync(fullPath)
    }
  }

  const index: Index = {}
  for (const [path, entry] of files) {
    const content = resolveMergeContent(entry)
    const fullPath = join(repoRoot, path)
    mkdirSync(dirname(fullPath), { recursive: true })
    writeFileSync(fullPath, content)

    if (conflicted.has(path)) continue

    let hash = entry.hash
    if (!hash) {
      const blob = createBlob(content)
      hash = blob.hash
      writeObjectToCache(repoRoot, blob.hash, serializeBlob(blob, content))
    }

    index[path] = {
      hash,
      mode: entry.mode === '100755' ? '100755' : '100644',
      size: content.length,
    }
  }
  return index
}

function lazyBlobContent(repoRoot: string, path: string, hash: string): () => Buffer {
  return () => {
    const content = extractBlobContent(repoRoot, hash)
    if (content === null) throw new Error(`missing blob ${hash.slice(0, 7)} for '${path}'`)
    return content
  }
}

function resolveMergeContent(entry: MergeFileEntry): Buffer {
  return typeof entry.content === 'function' ? entry.content() : entry.content
}

function createMergeCommit(
  repoRoot: string,
  oursHash: string,
  theirsHash: string,
  message: string,
  index: Index,
): string {
  const identity = resolveIdentity(repoRoot)
  if (!identity) {
    console.error(chalk.red('error: author identity unknown'))
    process.exit(1)
  }

  const flatEntries = Object.entries(index)
    .flatMap(([path, entry]) => (
      isResolvedIndexEntry(entry)
        ? [{ path, hash: entry.hash, mode: entry.mode }]
        : []
    ))
  const { rootTree, allTrees } = buildTreeFromPaths(flatEntries)
  for (const tree of allTrees) writeObjectToCache(repoRoot, tree.hash, serializeTree(tree))

  const now = Math.floor(Date.now() / 1000)
  const data: CommitData = {
    treeHash: rootTree.hash,
    parentHashes: [oursHash, theirsHash],
    author: { ...identity, timestamp: now },
    committer: { ...identity, timestamp: now },
    message,
  }
  const commit = createCommit(data)
  writeObjectToCache(repoRoot, commit.hash, serializeCommit(commit))

  const head = readHEAD(repoRoot)
  if (head.type === 'symbolic') writeRef(repoRoot, head.ref, commit.hash)
  writeIndex(repoRoot, index)
  return commit.hash
}

function findMergeBase(repoRoot: string, ours: string, theirs: string): string | null {
  const oursAncestors = ancestorDistances(repoRoot, ours)
  const theirsAncestors = ancestorDistances(repoRoot, theirs)
  let best: { hash: string; distance: number } | null = null

  for (const [hash, oursDistance] of oursAncestors) {
    const theirsDistance = theirsAncestors.get(hash)
    if (theirsDistance === undefined) continue
    const distance = oursDistance + theirsDistance
    if (!best || distance < best.distance) best = { hash, distance }
  }

  return best?.hash ?? null
}

function isAncestor(repoRoot: string, ancestor: string, descendant: string): boolean {
  return ancestorDistances(repoRoot, descendant).has(ancestor)
}

function ancestorDistances(repoRoot: string, start: string): Map<string, number> {
  const distances = new Map<string, number>()
  const queue: Array<{ hash: string; distance: number }> = [{ hash: start, distance: 0 }]

  while (queue.length > 0) {
    const next = queue.shift()!
    if (distances.has(next.hash)) continue
    distances.set(next.hash, next.distance)

    const commit = readCommitFromCache(repoRoot, next.hash)
    if (!commit) continue
    for (const parent of commit.parentHashes) {
      queue.push({ hash: parent, distance: next.distance + 1 })
    }
  }

  return distances
}
