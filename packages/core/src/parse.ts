/**
 * Deserialization utilities for Rekurn object types (blob, tree, commit).
 *
 * These are the inverse of the serialize* functions in blob.ts / tree.ts /
 * commit.ts.  They are used by:
 *   - The API when receiving uploaded objects (validate hash, populate DB).
 *   - The CLI push/fetch/clone transfer protocol (traverse object graph).
 */

import { sha256 } from '@rekurn/crypto'
import { createTree } from './tree.js'
import type { CommitObject, TreeObject, CommitData, Identity, TreeEntry } from '@rekurn/types'

// ---------------------------------------------------------------------------
// Type detection
// ---------------------------------------------------------------------------

export function detectObjectType(bytes: Buffer): 'blob' | 'tree' | 'commit' {
  const prefix = bytes.slice(0, 20).toString('ascii')
  if (prefix.startsWith('rekurn-blob\n')) return 'blob'
  if (prefix.startsWith('rekurn-tree\n')) return 'tree'
  if (prefix.startsWith('rekurn-commit\n')) return 'commit'
  throw new Error(`Unknown object type (prefix: ${JSON.stringify(prefix.slice(0, 14))})`)
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

function parseIdentity(s: string): Identity {
  // Format: "Name Here <email@example.com> 1234567890"
  const match = /^(.*?) <([^>]+)> (\d+)$/.exec(s)
  if (!match) throw new Error(`Cannot parse identity string: ${JSON.stringify(s)}`)
  return {
    name: match[1]!,
    email: match[2]!,
    timestamp: parseInt(match[3]!, 10),
  }
}

/**
 * Parse a commit from its serialized bytes and return a full CommitObject.
 * The hash is recomputed from the content (excluding the optional signature).
 */
export function parseCommit(bytes: Buffer): CommitObject {
  const text = bytes.toString('utf-8')
  const commitPrefix = 'rekurn-commit\n'
  if (!text.startsWith(commitPrefix)) throw new Error('Not a commit object')

  // Separate hashable body from optional trailing signature.
  // Signature is always the last element appended as "\nsignature <hex>".
  let body = text.slice(commitPrefix.length)
  let signature: string | undefined

  const sigMarker = '\nsignature '
  const sigIdx = body.lastIndexOf(sigMarker)
  if (sigIdx !== -1) {
    signature = body.slice(sigIdx + sigMarker.length).trim()
    body = body.slice(0, sigIdx)
  }

  // Split headers from message at the first blank line (\n\n)
  const blankIdx = body.indexOf('\n\n')
  if (blankIdx === -1) throw new Error('Malformed commit: no blank line separator between headers and message')

  const headerSection = body.slice(0, blankIdx)
  const message = body.slice(blankIdx + 2)

  const headers = headerSection.split('\n')
  let treeHash = ''
  const parentHashes: string[] = []
  let authorIdent: Identity | undefined
  let committerIdent: Identity | undefined

  for (const line of headers) {
    if (line.startsWith('tree ')) treeHash = line.slice(5).trim()
    else if (line.startsWith('parent ')) parentHashes.push(line.slice(7).trim())
    else if (line.startsWith('author ')) authorIdent = parseIdentity(line.slice(7))
    else if (line.startsWith('committer ')) committerIdent = parseIdentity(line.slice(10))
  }

  if (!treeHash) throw new Error('Malformed commit: missing tree hash')
  if (!authorIdent) throw new Error('Malformed commit: missing author')
  if (!committerIdent) throw new Error('Malformed commit: missing committer')

  const data: CommitData = {
    treeHash,
    parentHashes,
    author: authorIdent,
    committer: committerIdent,
    message,
    ...(signature !== undefined ? { signature } : {}),
  }

  // Recompute the hash from the hashable portion (body without signature)
  const hash = sha256(`${commitPrefix}${body}`)

  return { type: 'commit', hash, ...data }
}

// ---------------------------------------------------------------------------
// Tree
// ---------------------------------------------------------------------------

/**
 * Parse a tree from its serialized bytes and return a TreeObject.
 * The hash is recomputed from the canonical JSON representation.
 */
export function parseTree(bytes: Buffer): TreeObject {
  const text = bytes.toString('utf-8')
  const treePrefix = 'rekurn-tree\n'
  if (!text.startsWith(treePrefix)) throw new Error('Not a tree object')

  const json = text.slice(treePrefix.length)
  let parsed: { type?: string; entries?: unknown[] }
  try {
    parsed = JSON.parse(json) as { type?: string; entries?: unknown[] }
  } catch {
    throw new Error('Malformed tree: invalid JSON')
  }

  if (parsed.type !== 'tree' || !Array.isArray(parsed.entries)) {
    throw new Error('Malformed tree: unexpected structure')
  }

  // Validate entry shapes and reconstruct
  const entries: TreeEntry[] = (parsed.entries as Array<Record<string, unknown>>).map((e) => {
    if (
      typeof e.mode !== 'string' ||
      typeof e.name !== 'string' ||
      typeof e.hash !== 'string'
    ) {
      throw new Error('Malformed tree entry')
    }
    return { mode: e.mode as TreeEntry['mode'], name: e.name, hash: e.hash }
  })

  // createTree re-sorts entries deterministically and computes the canonical hash
  return createTree(entries)
}

// ---------------------------------------------------------------------------
// Blob
// ---------------------------------------------------------------------------

export interface ParsedBlob {
  hash: string
  size: number
  /** Raw file content (without the "rekurn-blob\n<size>\n" header). */
  content: Buffer
}

/**
 * Parse a blob from its serialized bytes.
 * The hash is the SHA-256 of the full serialized bytes.
 */
export function parseBlob(bytes: Buffer): ParsedBlob {
  const blobPrefix = 'rekurn-blob\n'
  const prefixBuf = Buffer.from(blobPrefix)

  if (!bytes.slice(0, prefixBuf.length).equals(prefixBuf)) {
    throw new Error('Not a blob object')
  }

  const afterPrefix = bytes.slice(prefixBuf.length)
  const newlineIdx = afterPrefix.indexOf(0x0a) // '\n'
  if (newlineIdx === -1) throw new Error('Malformed blob: no size newline')

  const sizeStr = afterPrefix.slice(0, newlineIdx).toString('ascii')
  const size = parseInt(sizeStr, 10)
  if (isNaN(size)) throw new Error('Malformed blob: invalid size field')

  const content = afterPrefix.slice(newlineIdx + 1)

  // Hash = sha256 of the full serialized bytes
  const hash = sha256(bytes)

  return { hash, size, content }
}

// ---------------------------------------------------------------------------
// Hash verification
// ---------------------------------------------------------------------------

/**
 * Compute the expected hash of a serialized object.
 * For commits the signature (if any) is excluded from the hash.
 */
export function computeObjectHash(bytes: Buffer): string {
  const text = bytes.toString('utf-8')

  if (text.startsWith('rekurn-commit\n')) {
    // Strip signature before hashing
    const sigIdx = text.lastIndexOf('\nsignature ')
    const hashable = sigIdx !== -1 ? text.slice(0, sigIdx) : text
    return sha256(hashable)
  }

  // Blobs and trees: hash the raw bytes
  return sha256(bytes)
}
