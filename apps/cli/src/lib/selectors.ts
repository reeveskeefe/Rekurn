import { readCommitFromCache, readRef, resolveHEAD, resolveToCommitHash } from './repo.js'

export interface ResolvedSelector {
  hash: string
  label: string
}

export function resolveSelector(repoRoot: string, selector: string): ResolvedSelector | null {
  if (selector.startsWith('@')) {
    const tag = selector.slice(1)
    const hash = readRef(repoRoot, `refs/tags/${tag}`)
    return hash ? { hash, label: selector } : null
  }

  const ancestor = resolveAncestorSelector(repoRoot, selector)
  if (ancestor) return ancestor

  const hash = resolveToCommitHash(repoRoot, selector)
  return hash ? { hash, label: selector } : null
}

export function resolveAtSelector(repoRoot: string, expression: string): ResolvedSelector | null {
  const targetTime = parseRelativeTime(expression)
  if (targetTime === null) return null

  let current = resolveHEAD(repoRoot)
  while (current) {
    const commit = readCommitFromCache(repoRoot, current)
    if (!commit) return null
    if (commit.author.timestamp <= targetTime) return { hash: current, label: `--at ${expression}` }
    current = commit.parentHashes[0] ?? null
  }

  return null
}

function resolveAncestorSelector(repoRoot: string, selector: string): ResolvedSelector | null {
  const match = /^(.+)~(\d+)$/.exec(selector)
  if (!match) return null

  const start = resolveToCommitHash(repoRoot, match[1]!)
  if (!start) return null

  let hash: string | null = start
  let remaining = Number(match[2]!)
  while (hash && remaining > 0) {
    const commit = readCommitFromCache(repoRoot, hash)
    hash = commit?.parentHashes[0] ?? null
    remaining--
  }

  return hash ? { hash, label: selector } : null
}

function parseRelativeTime(expression: string): number | null {
  const trimmed = expression.trim().toLowerCase()
  const absolute = Date.parse(trimmed)
  if (!Number.isNaN(absolute)) return Math.floor(absolute / 1000)

  const match = /^(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/.exec(trimmed)
  if (!match) return null

  const amount = Number(match[1]!)
  const unit = match[2]!
  const seconds =
    unit === 'second' ? amount :
    unit === 'minute' ? amount * 60 :
    unit === 'hour' ? amount * 3600 :
    unit === 'day' ? amount * 86400 :
    unit === 'week' ? amount * 604800 :
    unit === 'month' ? amount * 2592000 :
    amount * 31536000

  return Math.floor(Date.now() / 1000) - seconds
}
