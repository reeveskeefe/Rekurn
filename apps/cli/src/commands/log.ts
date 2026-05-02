import chalk from 'chalk'
import {
  requireRepoRoot,
  resolveHEAD,
  readCommitFromCache,
  listTags,
  readRef,
  readRefMetadata,
} from '../lib/repo.js'
import { formatCommitFull, formatCommitOneline, type CommitSummary } from '../lib/format.js'

export interface LogOptions {
  oneline?: boolean
  n?: number
}

export async function logCommand(options: LogOptions): Promise<void> {
  const repoRoot = requireRepoRoot()
  const headHash = resolveHEAD(repoRoot)

  if (!headHash) {
    console.log(chalk.dim('No commits yet.'))
    return
  }

  const max = options.n ?? Infinity
  const snapshots = snapshotDecorations(repoRoot)
  let count = 0
  let currentHash: string | null = headHash

  while (currentHash && count < max) {
    const commit = loadCommit(repoRoot, currentHash)
    if (!commit) {
      console.error(chalk.red(`fatal: bad object ${currentHash}`))
      break
    }

    if (options.oneline) {
      const suffix = snapshots.get(currentHash)
      console.log(formatCommitOneline(commit, headHash) + (suffix ? chalk.magenta(` ${suffix}`) : ''))
    } else {
      process.stdout.write(formatCommitFull(commit))
    }

    count++
    currentHash = commit.parentHashes[0] ?? null
  }
}

// ---------------------------------------------------------------------------
// Commit parsing
// ---------------------------------------------------------------------------

function loadCommit(repoRoot: string, hash: string): CommitSummary | null {
  const commit = readCommitFromCache(repoRoot, hash)
  if (!commit) return null
  return {
    hash,
    message: commit.message.trimEnd(),
    authorName: commit.author.name,
    authorEmail: commit.author.email,
    timestamp: commit.author.timestamp,
    parentHashes: commit.parentHashes,
  }
}

function snapshotDecorations(repoRoot: string): Map<string, string> {
  const meta = readRefMetadata(repoRoot)
  const result = new Map<string, string>()
  for (const tag of listTags(repoRoot)) {
    const refName = `refs/tags/${tag}`
    if (!meta[refName]?.isImmutable) continue
    const hash = readRef(repoRoot, refName)
    if (hash) result.set(hash, `@${tag}`)
  }
  return result
}
