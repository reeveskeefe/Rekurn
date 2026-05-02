/**
 * Object storage helpers — Vercel Blob + objects table.
 *
 * All Rekurn objects (blobs, trees, commits) are stored as raw serialized
 * bytes in Vercel Blob.  The `objects` table is a metadata index.
 *
 * Objects are globally content-addressed: the same SHA-256 hash can only
 * exist once in Vercel Blob regardless of which repo it came from.
 * `ON CONFLICT DO NOTHING` guards all inserts.
 */

import { put } from '@vercel/blob'
import { db, objects, commits } from '@rekurn/db'
import { eq, inArray } from 'drizzle-orm'
import { computeObjectHash, detectObjectType, parseCommit } from '@rekurn/core'

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/**
 * Store an object in Vercel Blob and record it in the objects table.
 * If the object already exists (same hash) the call is a no-op.
 * Returns the Vercel Blob URL.
 */
export async function storeObject(
  repoId: string,
  hash: string,
  bytes: Buffer,
): Promise<string> {
  // Check if already stored
  const existing = await db
    .select({ blobUrl: objects.blobUrl })
    .from(objects)
    .where(eq(objects.hash, hash))
    .limit(1)

  if (existing.length > 0 && existing[0].blobUrl) {
    return existing[0].blobUrl
  }

  const type = detectObjectType(bytes)

  // Upload to Vercel Blob at a globally-unique path by hash
  const blob = await put(`rekurn/objects/${hash}`, bytes, {
    access: 'public',
    token: process.env.BLOB_READ_WRITE_TOKEN,
    addRandomSuffix: false,
  })

  // Insert metadata (ignore conflict — another request may have uploaded simultaneously)
  await db
    .insert(objects)
    .values({
      hash,
      type,
      size: bytes.length,
      repoId,
      blobUrl: blob.url,
    })
    .onConflictDoNothing()

  // For commit objects, also populate the commits table for queryability
  if (type === 'commit') {
    await storeCommitRecord(repoId, hash, bytes)
  }

  return blob.url
}

// ---------------------------------------------------------------------------
// Retrieve
// ---------------------------------------------------------------------------

/**
 * Download the raw bytes for an object by hash.
 * Returns null if the object is not found.
 */
export async function getObjectBytes(hash: string): Promise<Buffer | null> {
  const rows = await db
    .select({ blobUrl: objects.blobUrl })
    .from(objects)
    .where(eq(objects.hash, hash))
    .limit(1)

  if (rows.length === 0 || !rows[0].blobUrl) return null

  const res = await fetch(rows[0].blobUrl)
  if (!res.ok) return null

  return Buffer.from(await res.arrayBuffer())
}

// ---------------------------------------------------------------------------
// Want / have negotiation
// ---------------------------------------------------------------------------

/**
 * Given a list of hashes, return the subset that the server does NOT have.
 */
export async function getMissingHashes(hashes: string[]): Promise<string[]> {
  if (hashes.length === 0) return []

  // Process in chunks to avoid hitting PostgreSQL parameter limits
  const CHUNK_SIZE = 500
  const present = new Set<string>()

  for (let i = 0; i < hashes.length; i += CHUNK_SIZE) {
    const chunk = hashes.slice(i, i + CHUNK_SIZE)
    const rows = await db
      .select({ hash: objects.hash })
      .from(objects)
      .where(inArray(objects.hash, chunk))

    for (const row of rows) present.add(row.hash)
  }

  return hashes.filter((h) => !present.has(h))
}

// ---------------------------------------------------------------------------
// Internal: commit record population
// ---------------------------------------------------------------------------

async function storeCommitRecord(
  repoId: string,
  hash: string,
  bytes: Buffer,
): Promise<void> {
  try {
    const commit = parseCommit(bytes)

    const authorIdent = `${commit.author.name} <${commit.author.email}> ${commit.author.timestamp}`
    const authoredAt = new Date(commit.author.timestamp * 1000)
    const committedAt = new Date(commit.committer.timestamp * 1000)

    await db
      .insert(commits)
      .values({
        hash,
        repoId,
        treeHash: commit.treeHash,
        parentHashes: commit.parentHashes,
        authorId: null,
        authorIdent,
        authoredAt,
        committedAt,
        message: commit.message,
        signature: commit.signature ?? null,
      })
      .onConflictDoNothing()
  } catch (err) {
    // Non-fatal: commit metadata is supplementary; the raw bytes are stored.
    console.error('[objects] Failed to parse/store commit record:', err)
  }
}

// ---------------------------------------------------------------------------
// Hash validation
// ---------------------------------------------------------------------------

/**
 * Validate that the declared hash matches the actual content hash.
 * Throws if they differ.
 */
export function validateObjectHash(declaredHash: string, bytes: Buffer): void {
  const actual = computeObjectHash(bytes)
  if (actual !== declaredHash) {
    throw new Error(`Hash mismatch: declared ${declaredHash.slice(0, 12)}… but computed ${actual.slice(0, 12)}…`)
  }
}
