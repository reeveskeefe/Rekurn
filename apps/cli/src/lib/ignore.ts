import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import picomatch from 'picomatch'

const DEFAULT_IGNORE = [
  '.rekurn',
  '.rekurn/**',
  'node_modules',
  'node_modules/**',
  '.git',
  '.git/**',
]

/**
 * Build an ignore-check function for a repository root.
 *
 * Reads `.rekurnignore` from the repo root if it exists and merges
 * its patterns with the built-in defaults.
 */
export function buildIgnoreMatcher(repoRoot: string): (relativePath: string) => boolean {
  const patterns = [...DEFAULT_IGNORE]

  const ignorePath = join(repoRoot, '.rekurnignore')
  if (existsSync(ignorePath)) {
    const lines = readFileSync(ignorePath, 'utf8').split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed && !trimmed.startsWith('#')) {
        patterns.push(trimmed)
        // Also add a recursive glob version
        if (!trimmed.includes('*')) patterns.push(`${trimmed}/**`)
      }
    }
  }

  const isMatch = picomatch(patterns, { dot: true })
  return (relativePath: string) => isMatch(relativePath)
}
