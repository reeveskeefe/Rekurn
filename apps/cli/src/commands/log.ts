import chalk from 'chalk'
import {
  requireRepoRoot,
  resolveHEAD,
  readObjectFromCache,
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
  let count = 0
  let currentHash: string | null = headHash

  while (currentHash && count < max) {
    const commit = loadCommit(repoRoot, currentHash)
    if (!commit) {
      console.error(chalk.red(`fatal: bad object ${currentHash}`))
      break
    }

    if (options.oneline) {
      console.log(formatCommitOneline(commit, headHash))
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

/**
 * Read and parse a commit object from the local cache.
 * We parse our own text format rather than using @rekurn/core to keep the
 * CLI self-contained for read operations.
 */
function loadCommit(repoRoot: string, hash: string): CommitSummary | null {
  const buf = readObjectFromCache(repoRoot, hash)
  if (!buf) return null

  const text = buf.toString('utf8')

  // Strip the "rekurn-commit\n" prefix to get the body
  const prefixEnd = text.indexOf('\n')
  const body = prefixEnd >= 0 ? text.slice(prefixEnd + 1) : text

  const lines = body.split('\n')
  let parentHashes: string[] = []
  let authorLine = ''
  let message = ''
  let inMessage = false

  for (const line of lines) {
    if (inMessage) {
      message += (message ? '\n' : '') + line
      continue
    }
    if (line === '') {
      inMessage = true
      continue
    }
    if (line.startsWith('parent ')) parentHashes.push(line.slice(7))
    else if (line.startsWith('author ')) authorLine = line.slice(7)
  }

  // Parse "Name <email> timestamp"
  const authorMatch = authorLine.match(/^(.+) <(.+)> (\d+)$/)
  const authorName = authorMatch?.[1] ?? 'Unknown'
  const authorEmail = authorMatch?.[2] ?? ''
  const timestamp = parseInt(authorMatch?.[3] ?? '0', 10)

  return { hash, message: message.trimEnd(), authorName, authorEmail, timestamp, parentHashes }
}
