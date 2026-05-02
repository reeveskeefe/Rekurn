import chalk from 'chalk'
import { computeObjectHash, detectObjectType, parseCommit, parseTree } from '@rekurn/core'
import { verifySignature } from '@rekurn/crypto'
import {
  readObjectFromCache,
  requireRepoRoot,
  resolveHEAD,
} from '../lib/repo.js'

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

    const bytes = readObjectFromCache(repoRoot, hash)
    if (!bytes) {
      errors.push(`missing object ${hash}`)
      continue
    }

    const actual = computeObjectHash(bytes)
    if (actual !== hash) errors.push(`hash mismatch ${hash.slice(0, 7)} computed ${actual.slice(0, 7)}`)

    try {
      const type = detectObjectType(bytes)
      if (type === 'commit') {
        const commit = parseCommit(bytes)
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
        const tree = parseTree(bytes)
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
