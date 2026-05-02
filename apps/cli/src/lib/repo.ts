import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import type { Head, Index, RepoConfig } from '@rekurn/types'

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export const REKURN_DIR = '.rekurn'

/** Walk up from `startDir` to find the nearest ancestor containing .rekurn/ */
export function findRepoRoot(startDir: string): string | null {
  let current = startDir
  while (true) {
    if (existsSync(join(current, REKURN_DIR))) return current
    const parent = dirname(current)
    if (parent === current) return null // filesystem root
    current = parent
  }
}

/** Require a repo root or exit with an error. */
export function requireRepoRoot(): string {
  const root = findRepoRoot(process.cwd())
  if (!root) {
    console.error('fatal: not a rekurn repository (or any parent up to mount point)')
    process.exit(1)
  }
  return root
}

export function rekurnDir(repoRoot: string): string {
  return join(repoRoot, REKURN_DIR)
}

// ---------------------------------------------------------------------------
// HEAD
// ---------------------------------------------------------------------------

const SYMBOLIC_PREFIX = 'ref: '

export function readHEAD(repoRoot: string): Head {
  const headPath = join(rekurnDir(repoRoot), 'HEAD')
  if (!existsSync(headPath)) {
    return { type: 'symbolic', ref: 'refs/heads/main' }
  }
  const raw = readFileSync(headPath, 'utf8').trim()
  if (raw.startsWith(SYMBOLIC_PREFIX)) {
    return { type: 'symbolic', ref: raw.slice(SYMBOLIC_PREFIX.length) }
  }
  return { type: 'detached', hash: raw }
}

export function writeHEAD(repoRoot: string, head: Head): void {
  const headPath = join(rekurnDir(repoRoot), 'HEAD')
  const content =
    head.type === 'symbolic' ? `${SYMBOLIC_PREFIX}${head.ref}` : head.hash
  writeFileSync(headPath, content + '\n', 'utf8')
}

/** Resolve HEAD to its commit hash, or null if no commits yet. */
export function resolveHEAD(repoRoot: string): string | null {
  const head = readHEAD(repoRoot)
  if (head.type === 'detached') return head.hash
  return readRef(repoRoot, head.ref)
}

// ---------------------------------------------------------------------------
// Refs
// ---------------------------------------------------------------------------

export function readRef(repoRoot: string, refName: string): string | null {
  const refPath = join(rekurnDir(repoRoot), refName)
  if (!existsSync(refPath)) return null
  return readFileSync(refPath, 'utf8').trim()
}

export function writeRef(repoRoot: string, refName: string, hash: string): void {
  const refPath = join(rekurnDir(repoRoot), refName)
  mkdirSync(dirname(refPath), { recursive: true })
  writeFileSync(refPath, hash + '\n', 'utf8')
}

/** Get the name of the current branch (e.g. "main"), or null if detached. */
export function currentBranch(repoRoot: string): string | null {
  const head = readHEAD(repoRoot)
  if (head.type !== 'symbolic') return null
  // "refs/heads/main" → "main"
  return head.ref.replace(/^refs\/heads\//, '')
}

// ---------------------------------------------------------------------------
// Staging index
// ---------------------------------------------------------------------------

export function readIndex(repoRoot: string): Index {
  const indexPath = join(rekurnDir(repoRoot), 'index')
  if (!existsSync(indexPath)) return {}
  try {
    return JSON.parse(readFileSync(indexPath, 'utf8')) as Index
  } catch {
    return {}
  }
}

export function writeIndex(repoRoot: string, index: Index): void {
  const indexPath = join(rekurnDir(repoRoot), 'index')
  writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf8')
}

// ---------------------------------------------------------------------------
// Object cache  (.rekurn/objects/cache/<hash[0:2]>/<hash[2:]>)
// ---------------------------------------------------------------------------

export function objectCachePath(repoRoot: string, hash: string): string {
  return join(rekurnDir(repoRoot), 'objects', 'cache', hash.slice(0, 2), hash.slice(2))
}

export function readObjectFromCache(repoRoot: string, hash: string): Buffer | null {
  const p = objectCachePath(repoRoot, hash)
  if (!existsSync(p)) return null
  return readFileSync(p)
}

export function writeObjectToCache(repoRoot: string, hash: string, content: Buffer): void {
  const p = objectCachePath(repoRoot, hash)
  mkdirSync(dirname(p), { recursive: true })
  if (!existsSync(p)) {
    // Objects are immutable — skip if already cached
    writeFileSync(p, content)
  }
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export type { RepoConfig }

export function globalConfigPath(): string {
  return join(homedir(), '.rekurn', 'config')
}

export function readConfig(repoRoot: string): Partial<RepoConfig> {
  // Merge global config → repo config (repo wins)
  const global = readConfigFile(globalConfigPath())
  const local = readConfigFile(join(rekurnDir(repoRoot), 'config'))
  return deepMerge(global, local)
}

export function writeLocalConfig(repoRoot: string, config: Partial<RepoConfig>): void {
  const configPath = join(rekurnDir(repoRoot), 'config')
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8')
}

function readConfigFile(p: string): Partial<RepoConfig> {
  if (!existsSync(p)) return {}
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as Partial<RepoConfig>
  } catch {
    return {}
  }
}

function deepMerge<T extends object>(base: T, override: Partial<T>): T {
  const result = { ...base }
  for (const key of Object.keys(override) as Array<keyof T>) {
    const ov = override[key]
    if (ov !== undefined) {
      if (typeof ov === 'object' && ov !== null && !Array.isArray(ov)) {
        result[key] = deepMerge(
          (result[key] as object ?? {}) as T[typeof key] & object,
          ov as Partial<T[typeof key] & object>,
        ) as T[typeof key]
      } else {
        result[key] = ov as T[typeof key]
      }
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Identity resolution
// ---------------------------------------------------------------------------

export interface Identity {
  name: string
  email: string
}

/**
 * Resolve the author/committer identity from config or environment variables.
 * Returns null if no identity is configured.
 */
export function resolveIdentity(repoRoot: string): Identity | null {
  const config = readConfig(repoRoot)
  const name = process.env['REKURN_AUTHOR_NAME'] ?? config.user?.name
  const email = process.env['REKURN_AUTHOR_EMAIL'] ?? config.user?.email
  if (name && email) return { name, email }
  return null
}

// ---------------------------------------------------------------------------
// Branch listing
// ---------------------------------------------------------------------------

/** Returns all branch names in refs/heads/, sorted alphabetically. */
export function listBranches(repoRoot: string): string[] {
  const headsDir = join(rekurnDir(repoRoot), 'refs', 'heads')
  if (!existsSync(headsDir)) return []
  return readdirSync(headsDir)
    .filter(f => statSync(join(headsDir, f)).isFile())
    .sort()
}

// ---------------------------------------------------------------------------
// Ref / hash resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a user-supplied string to a full 64-char commit hash.
 *
 * Resolution order:
 *  1. Branch name  (refs/heads/<ref>)
 *  2. Tag          (refs/tags/<ref>)
 *  3. Full 64-char hex hash (verified against object cache)
 *  4. Short hex prefix (≥4 chars) — scans object cache for a unique match
 *
 * Returns null if the ref cannot be resolved.
 */
export function resolveToCommitHash(repoRoot: string, ref: string): string | null {
  // 1. Branch
  const branchHash = readRef(repoRoot, `refs/heads/${ref}`)
  if (branchHash) return branchHash

  // 2. Tag
  const tagHash = readRef(repoRoot, `refs/tags/${ref}`)
  if (tagHash) return tagHash

  // 3. Full hash
  if (/^[0-9a-f]{64}$/i.test(ref)) {
    const p = objectCachePath(repoRoot, ref.toLowerCase())
    return existsSync(p) ? ref.toLowerCase() : null
  }

  // 4. Short hash prefix (min 4 chars to avoid trivial ambiguity)
  if (/^[0-9a-f]{4,63}$/i.test(ref)) {
    return resolveShortHash(repoRoot, ref.toLowerCase())
  }

  return null
}

/**
 * Scan .rekurn/objects/cache for a unique match of a short hash prefix.
 * Returns the full hash if exactly one match is found; null otherwise.
 */
function resolveShortHash(repoRoot: string, prefix: string): string | null {
  const bucketDir = join(rekurnDir(repoRoot), 'objects', 'cache', prefix.slice(0, 2))
  if (!existsSync(bucketDir)) return null

  const rest = prefix.slice(2)
  const matches = readdirSync(bucketDir).filter(f => f.startsWith(rest))

  if (matches.length === 1) return prefix.slice(0, 2) + matches[0]!
  // 0 = not found; >1 = ambiguous — caller handles both as null
  return null
}
