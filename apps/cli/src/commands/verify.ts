import chalk from 'chalk'
import { open } from 'fs/promises'
import { computeObjectHash, detectObjectType, parseCommit, parseTree } from '@rekurn/core'
import { verifySignature } from '@rekurn/crypto'
import {
  objectCachePath,
  readObjectFromCache,
  requireRepoRoot,
  resolveHEAD,
} from '../lib/repo.js'
import { hashFileBytes } from '../lib/file-objects.js'

export async function verifyCommand(): Promise<void> {
  const repoRoot = requireRepoRoot()
  const head = resolveHEAD(repoRoot)
  if (!head) {
    console.log(chalk.dim('No commits yet.'))
    return
  }

  const publicKey = process.env.REKURN_VERIFY_PUBLIC_KEY
  const visited = new Set<string>()
  const errors: string[] = []
  const warnings: string[] = []
  const queue = [head]

  while (queue.length > 0) {
    const hash = queue.shift()!
    if (visited.has(hash)) continue
    visited.add(hash)

    const objectPath = objectCachePath(repoRoot, hash)
    const type = await detectObjectTypeFromFile(objectPath)
    if (type === 'missing') {
      errors.push(`missing object ${hash}`)
      continue
    }
    if (type === 'corrupt') {
      errors.push(`corrupt object ${hash.slice(0, 7)}: unknown object type`)
      continue
    }

    const bytes = type === 'blob' ? null : readObjectFromCache(repoRoot, hash)
    if (type !== 'blob' && !bytes) {
      errors.push(`missing object ${hash}`)
      continue
    }

    const actual = type === 'blob' ? await hashFileBytes(objectPath) : computeObjectHash(bytes!)
    if (actual !== hash) errors.push(`hash mismatch ${hash.slice(0, 7)} computed ${actual.slice(0, 7)}`)

    try {
      if (type === 'commit') {
        const commit = parseCommit(bytes!)
        if (commit.signature) {
          if (publicKey) {
            const ok = verifySignature(Buffer.from(commit.hash, 'hex'), commit.signature, publicKey)
            if (!ok) errors.push(`bad signature on commit ${hash.slice(0, 7)}`)
          } else {
            warnings.push(`commit ${hash.slice(0, 7)} is signed, but REKURN_VERIFY_PUBLIC_KEY is not set`)
          }
        }
        queue.push(commit.treeHash, ...commit.parentHashes)
      } else if (type === 'tree') {
        const tree = parseTree(bytes!)
        for (const entry of tree.entries) queue.push(entry.hash)
      }
    } catch (err) {
      errors.push(`corrupt object ${hash.slice(0, 7)}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  for (const warning of warnings) console.log(chalk.yellow(`warning: ${warning}`))
  if (errors.length > 0) {
    for (const error of errors) console.error(chalk.red(`error: ${error}`))
    process.exit(1)
  }

  console.log(`${chalk.green('verified')} ${visited.size} object${visited.size === 1 ? '' : 's'} from HEAD`)
}

async function detectObjectTypeFromFile(path: string): Promise<'blob' | 'tree' | 'commit' | 'missing' | 'corrupt'> {
  let file: Awaited<ReturnType<typeof open>> | null = null
  try {
    file = await open(path, 'r')
    const buffer = Buffer.alloc(20)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    return detectObjectType(buffer.subarray(0, bytesRead))
  } catch (err) {
    return isMissingFileError(err) ? 'missing' : 'corrupt'
  } finally {
    await file?.close().catch(() => undefined)
  }
}

function isMissingFileError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT'
}
