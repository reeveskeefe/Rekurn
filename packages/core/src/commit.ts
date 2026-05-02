import { sha256 } from '@rekurn/crypto'
import type { CommitData, CommitObject, Identity } from '@rekurn/types'

/**
 * Produce the canonical text representation of a commit body.
 *
 * This is the exact bytes that are hashed and (optionally) signed.
 * Format is Git-inspired but uses SHA-256 hashes.
 *
 * Example:
 *   tree a3b4c5...
 *   parent e1f2d3...
 *   author Alice <alice@example.com> 1746172800
 *   committer Alice <alice@example.com> 1746172800
 *
 *   initial commit
 */
export function serializeCommitBody(data: CommitData): string {
  const lines: string[] = []

  lines.push(`tree ${data.treeHash}`)

  for (const parent of data.parentHashes) {
    lines.push(`parent ${parent}`)
  }

  lines.push(`author ${formatIdentity(data.author)}`)
  lines.push(`committer ${formatIdentity(data.committer)}`)
  lines.push('') // blank line separates headers from message
  lines.push(data.message.trimEnd())

  return lines.join('\n')
}

function formatIdentity(id: Identity): string {
  return `${id.name} <${id.email}> ${id.timestamp}`
}

/**
 * Create a Commit object.
 *
 * The hash format is:
 *   SHA-256("rekurn-commit\n<commit-body>")
 *
 * If `data.signature` is provided it is included in the returned object but
 * does NOT affect the hash (signatures are computed over the hash, not
 * included in it — this matches the common detached-signature model).
 */
export function createCommit(data: CommitData): CommitObject {
  const body = serializeCommitBody(data)
  const hash = sha256(`rekurn-commit\n${body}`)
  return { type: 'commit', hash, ...data }
}

/**
 * Compute the hash for a commit without constructing the full object.
 */
export function hashCommit(data: CommitData): string {
  return createCommit(data).hash
}

/**
 * Produce the canonical byte representation of a commit for storage.
 */
export function serializeCommit(commit: CommitObject): Buffer {
  const body = serializeCommitBody(commit)
  const prefix = `rekurn-commit\n`
  const lines = [prefix + body]
  if (commit.signature) {
    lines.push(`\nsignature ${commit.signature}`)
  }
  return Buffer.from(lines.join(''))
}
