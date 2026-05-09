import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import picomatch from 'picomatch'

// Built-in patterns that are always ignored regardless of .rekurnignore.
// Each entry is expanded into bare, **/<name>, <name>/**, and **/<name>/**
// forms by expandPattern() below.
const DEFAULT_IGNORE_NAMES = [
  '.rekurn',
  'node_modules',
  '.git',
  '.next',
  'dist',
  '.turbo',
  'build',
  '.vercel',
]

/**
 * Expand a single ignore pattern into all the forms picomatch needs to
 * correctly prune both the directory itself and its contents at any depth.
 *
 * A bare name like "dist" expands to: dist, dist/**, *\/dist, *\/dist/**
 * A rooted path like "a/b" expands to: a/b, a/b/**
 * A glob like "**\/foo" is kept as-is plus foo/**, **\/foo/**
 */
function expandPattern(raw: string): string[] {
  // Strip trailing slash — directory-only marker; we handle dirs in walkFilePaths
  const p = raw.endsWith('/') ? raw.slice(0, -1) : raw
  if (!p) return []

  const results = new Set<string>()
  results.add(p)
  results.add(`${p}/**`)

  // If pattern has no path separator and no leading **, also match at any depth
  if (!p.startsWith('**/') && !p.startsWith('/')) {
    results.add(`**/${p}`)
    results.add(`**/${p}/**`)
  }

  return [...results]
}

/**
 * Build an ignore-check function for a repository root.
 *
 * Reads `.rekurnignore` from the repo root if it exists and merges
 * its patterns with the built-in defaults.
 */
export function buildIgnoreMatcher(repoRoot: string): (relativePath: string) => boolean {
  const patterns: string[] = DEFAULT_IGNORE_NAMES.flatMap(expandPattern)

  const ignorePath = join(repoRoot, '.rekurnignore')
  if (existsSync(ignorePath)) {
    const lines = readFileSync(ignorePath, 'utf8').split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed && !trimmed.startsWith('#')) {
        patterns.push(...expandPattern(trimmed))
      }
    }
  }

  const isMatch = picomatch(patterns, { dot: true })
  // Also test with trailing slash so patterns ending in / match directory entries
  return (relativePath: string) =>
    isMatch(relativePath) || isMatch(relativePath + '/')
}
