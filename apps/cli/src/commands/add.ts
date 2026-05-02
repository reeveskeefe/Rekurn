import { existsSync } from 'fs'
import { join, relative } from 'path'
import chalk from 'chalk'
import {
  requireRepoRoot,
  readIndex,
  writeIndex,
  isResolvedIndexEntry,
} from '../lib/repo.js'
import { buildIgnoreMatcher } from '../lib/ignore.js'
import { defaultFileConcurrency } from '../lib/concurrency.js'
import { createBlobObjectFromFile, walkFilePaths } from '../lib/file-objects.js'

export async function addCommand(paths: string[]): Promise<void> {
  const repoRoot = requireRepoRoot()
  const index = readIndex(repoRoot)
  const shouldIgnore = buildIgnoreMatcher(repoRoot)

  const targets = paths.length === 0 || (paths.length === 1 && paths[0] === '.')
    ? [repoRoot]
    : paths.map((p) => join(process.cwd(), p))

  let addedCount = 0
  let updatedCount = 0
  const pending = new Set<Promise<void>>()
  const concurrency = defaultFileConcurrency()

  for (const target of targets) {
    if (!existsSync(target)) {
      console.error(chalk.red(`error: pathspec '${target}' did not match any files`))
      process.exit(1)
    }

    for await (const filePath of walkFilePaths(target, repoRoot, shouldIgnore)) {
      let task!: Promise<void>
      task = stageFile(filePath).finally(() => pending.delete(task))
      pending.add(task)

      if (pending.size >= concurrency) {
        await Promise.race(pending)
      }
    }
  }

  await Promise.all(pending)
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

  async function stageFile(filePath: string): Promise<void> {
    const relPath = relative(repoRoot, filePath)
    const blob = await createBlobObjectFromFile(repoRoot, filePath)

    const existing = index[relPath]
    if (!existing) {
      addedCount++
    } else if (!isResolvedIndexEntry(existing) || existing.hash !== blob.hash) {
      updatedCount++
    }

    index[relPath] = { hash: blob.hash, mode: blob.mode, size: blob.size }
  }
}
