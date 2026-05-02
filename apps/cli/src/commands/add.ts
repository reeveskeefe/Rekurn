import { existsSync, readdirSync, statSync, readFileSync } from 'fs'
import { join, relative } from 'path'
import chalk from 'chalk'
import { createBlob, serializeBlob } from '@rekurn/core'
import {
  requireRepoRoot,
  readIndex,
  writeIndex,
  writeObjectToCache,
  isResolvedIndexEntry,
} from '../lib/repo.js'
import { buildIgnoreMatcher } from '../lib/ignore.js'

export async function addCommand(paths: string[]): Promise<void> {
  const repoRoot = requireRepoRoot()
  const index = readIndex(repoRoot)
  const shouldIgnore = buildIgnoreMatcher(repoRoot)

  const targets = paths.length === 0 || (paths.length === 1 && paths[0] === '.')
    ? [repoRoot]
    : paths.map((p) => join(process.cwd(), p))

  let addedCount = 0
  let updatedCount = 0

  for (const target of targets) {
    if (!existsSync(target)) {
      console.error(chalk.red(`error: pathspec '${target}' did not match any files`))
      process.exit(1)
    }
    const filePaths = collectFiles(target, repoRoot, shouldIgnore)
    for (const filePath of filePaths) {
      const relPath = relative(repoRoot, filePath)
      const content = readFileSync(filePath)
      const blob = createBlob(content)
      const serialized = serializeBlob(blob, content)

      writeObjectToCache(repoRoot, blob.hash, serialized)

      const stat = statSync(filePath)
      const mode = (stat.mode & 0o111) !== 0 ? '100755' : '100644'

      const existing = index[relPath]
      if (!existing) {
        addedCount++
      } else if (!isResolvedIndexEntry(existing) || existing.hash !== blob.hash) {
        updatedCount++
      }

      index[relPath] = { hash: blob.hash, mode, size: blob.size }
    }
  }

  writeIndex(repoRoot, index)

  const total = addedCount + updatedCount
  if (total === 0) {
    console.log(chalk.dim('Nothing new to add.'))
  } else {
    const parts: string[] = []
    if (addedCount > 0) parts.push(`${addedCount} new`)
    if (updatedCount > 0) parts.push(`${updatedCount} updated`)
    console.log(`Staged ${parts.join(', ')} file${total !== 1 ? 's' : ''}.`)
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function collectFiles(
  target: string,
  repoRoot: string,
  shouldIgnore: (rel: string) => boolean,
): string[] {
  const stat = statSync(target)
  if (stat.isFile()) {
    const rel = relative(repoRoot, target)
    return shouldIgnore(rel) ? [] : [target]
  }

  const results: string[] = []
  walkDir(target, repoRoot, shouldIgnore, results)
  return results
}

function walkDir(
  dir: string,
  repoRoot: string,
  shouldIgnore: (rel: string) => boolean,
  acc: string[],
): void {
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    const rel = relative(repoRoot, fullPath)
    if (shouldIgnore(rel)) continue

    if (entry.isDirectory()) {
      walkDir(fullPath, repoRoot, shouldIgnore, acc)
    } else if (entry.isFile()) {
      acc.push(fullPath)
    }
  }
}
