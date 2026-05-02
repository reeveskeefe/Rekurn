import { sha256 } from '@rekurn/crypto'
import type { BlobObject } from '@rekurn/types'

/**
 * Create a Blob object from raw file content.
 *
 * The hash format is:
 *   SHA-256("rekurn-blob\n<size>\n<content>")
 *
 * This prefix ensures Rekurn blob hashes are distinct from arbitrary
 * file SHA-256 hashes and from Git SHA-1 hashes.
 */
export function createBlob(content: Buffer): BlobObject {
  const header = blobHeader(content.length)
  const data = Buffer.concat([header, content])
  const hash = sha256(data)
  return {
    type: 'blob',
    hash,
    size: content.length,
  }
}

/**
 * Produce the canonical byte representation of a blob for storage or transport.
 * The stored format is the same data used to compute the hash.
 */
export function serializeBlob(blob: BlobObject, content: Buffer): Buffer {
  const header = blobHeader(blob.size)
  return Buffer.concat([header, content])
}

/**
 * Compute the hash for a blob without constructing the full object.
 */
export function hashBlob(content: Buffer): string {
  return createBlob(content).hash
}

export function blobHeader(size: number): Buffer {
  return Buffer.from(`rekurn-blob\n${size}\n`)
}
