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

import { put, get } from '@vercel/blob'
import { db, objects, commits } from '@rekurn/db'
import { eq, inArray } from 'drizzle-orm'
import { computeObjectHash, detectObjectType, parseCommit } from '@rekurn/core'
import { mapLimit } from './concurrency'

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
    access: 'private',
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

  // Guard against SSRF: only fetch from expected Vercel Blob domains
  const blobUrl = rows[0].blobUrl
  try {
    const parsed = new URL(blobUrl)
    const isVercelBlob =
      parsed.protocol === 'https:' &&
      parsed.hostname.endsWith('.blob.vercel-storage.com')
    if (!isVercelBlob) {
      console.error('[objects] Refusing to fetch suspicious blobUrl:', blobUrl)
      return null
    }
  } catch {
    return null
  }

  // Private blobs require authentication — use the SDK's get() which handles auth automatically
  const result = await get(blobUrl, {
    access: 'private',
    token: process.env.BLOB_READ_WRITE_TOKEN,
  })

  if (!result || result.statusCode !== 200) return null

  const reader = result.stream.getReader()
  const chunks: Uint8Array[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) chunks.push(value)
  }
  return Buffer.concat(chunks)
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
  const CHUNK_SIZE = 2_000
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
// Batch store — used by upload-batch route
// ---------------------------------------------------------------------------

/**
 * Store multiple objects efficiently:
 *   1. One inArray SELECT to find which hashes are truly new.
 *   2. Parallel Blob PUTs for new objects only (concurrency 32).
 *   3. One batch INSERT for all metadata.
 *
 * This replaces the old pattern of N×storeObject calls (each with its own SELECT),
 * which was the primary bottleneck on Vercel free tier (10 s function limit).
 */
export async function storeObjectBatch(
  repoId: string,
  items: Array<{ hash: string; bytes: Buffer }>,
): Promise<void> {
  if (items.length === 0) return

  // 1. Single existence check across all hashes
  const existingRows = await db
    .select({ hash: objects.hash })
    .from(objects)
    .where(inArray(objects.hash, items.map((o) => o.hash)))
  const existingHashes = new Set(existingRows.map((r) => r.hash))
  const newItems = items.filter((o) => !existingHashes.has(o.hash))

  if (newItems.length === 0) return

  // 2. Parallel Blob PUTs for new objects only
  const stored = await mapLimit(
    newItems,
    32,
    async (item): Promise<{ hash: string; bytes: Buffer; blobUrl: string; type: string }> => {
      const type = detectObjectType(item.bytes)
      const blob = await put(`rekurn/objects/${item.hash}`, item.bytes, {
        access: 'private',
        token: process.env.BLOB_READ_WRITE_TOKEN,
        addRandomSuffix: false,
      })
      return { hash: item.hash, bytes: item.bytes, blobUrl: blob.url, type }
    },
  )

  // 3. One batch INSERT for all object metadata
  await db
    .insert(objects)
    .values(
      stored.map((o) => ({
        hash: o.hash,
        type: o.type,
        size: o.bytes.length,
        repoId,
        blobUrl: o.blobUrl,
      })),
    )
    .onConflictDoNothing()

  // 4. Commit records (rare per push; run concurrently)
  await Promise.all(
    stored
      .filter((o) => o.type === 'commit')
      .map((o) => storeCommitRecord(repoId, o.hash, o.bytes)),
  )
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
