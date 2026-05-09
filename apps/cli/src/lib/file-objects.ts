import { createHash, randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { access, mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { once } from 'node:events'
import { basename, dirname, join, relative } from 'node:path'
import { blobHeader } from '@rekurn/core'
import { objectCachePath } from './repo.js'

export interface FileBlobObject {
  hash: string
  mode: '100644' | '100755'
  size: number
}

export async function hashFileAsBlob(filePath: string, size?: number): Promise<string> {
  const fileSize = size ?? (await stat(filePath)).size
  const hash = createHash('sha256')
  hash.update(blobHeader(fileSize))

  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk as Buffer)
  }

  return hash.digest('hex')
}

export async function hashFileBytes(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk as Buffer)
  }
  return hash.digest('hex')
}

export async function createBlobObjectFromFile(
  repoRoot: string,
  filePath: string,
): Promise<FileBlobObject> {
  const stats = await stat(filePath)
  const hash = await hashFileAsBlob(filePath, stats.size)
  await writeFileBlobToCache(repoRoot, hash, filePath, stats.size)

  return {
    hash,
    mode: fileMode(stats.mode),
    size: stats.size,
  }
}

export async function writeFileBlobToCache(
  repoRoot: string,
  hash: string,
  filePath: string,
  size: number,
): Promise<void> {
  const target = objectCachePath(repoRoot, hash)
  if (await pathExists(target)) return

  const dir = dirname(target)
  await mkdir(dir, { recursive: true })
  const temp = join(dir, `.${basename(target)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`)
  const output = createWriteStream(temp, { flags: 'wx' })

  try {
    if (!output.write(blobHeader(size))) await once(output, 'drain')
    await new Promise<void>((resolve, reject) => {
      const input = createReadStream(filePath)
      input.on('error', reject)
      output.on('error', reject)
      output.on('finish', resolve)
      input.pipe(output)
    })
    await rename(temp, target)
  } catch (err) {
    output.destroy()
    await rm(temp, { force: true }).catch(() => undefined)
    throw err
  }
}

export async function* walkFilePaths(
  target: string,
  repoRoot: string,
  shouldIgnore: (relativePath: string) => boolean,
): AsyncGenerator<string> {
  const stats = await stat(target)
  if (stats.isFile()) {
    const rel = relative(repoRoot, target)
    if (!shouldIgnore(rel)) yield target
    return
  }

  if (!stats.isDirectory()) return

  const entries = await readdir(target, { withFileTypes: true })
  entries.sort((a, b) => a.name.localeCompare(b.name))

  for (const entry of entries) {
    const fullPath = join(target, entry.name)
    const rel = relative(repoRoot, fullPath)

    // For directories, pass both the bare path and the path + '/' so that
    // patterns like '.next/' or '**/.next/' correctly prune the directory
    // before we ever recurse into it.
    if (entry.isDirectory()) {
      if (shouldIgnore(rel) || shouldIgnore(rel + '/')) continue
      yield* walkFilePaths(fullPath, repoRoot, shouldIgnore)
    } else if (entry.isFile()) {
      if (shouldIgnore(rel)) continue
      yield fullPath
    }
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function fileMode(mode: number): '100644' | '100755' {
  return (mode & 0o111) !== 0 ? '100755' : '100644'
}
