/**
 * Object transfer protocol for the Rekurn CLI.
 *
 * Handles push (collect → want → upload) and fetch (download + BFS) logic,
 * keeping all raw HTTP details in one place.
 */

import { parseCommit, parseTree, detectObjectType } from '@rekurn/core'
import { readObjectFromCache, writeObjectToCache } from './repo.js'
import { createHash } from 'node:crypto'
import type { RemoteInfo } from './remote.js'
import { mapLimit } from './concurrency.js'

const HASH_CHUNK_SIZE = 5_000
const MAX_BATCH_REQUEST_BYTES = 25 * 1024 * 1024
const SINGLE_TRANSFER_CONCURRENCY = 6

// Ref names must be heads/<name> or tags/<name> with safe characters only
const SAFE_REF_NAME = /^(heads|tags)\/[a-zA-Z0-9][a-zA-Z0-9._\-/]{0,198}$/
const HASH_RE = /^[0-9a-f]{64}$/

// ---------------------------------------------------------------------------
// Internal HTTP helpers
// ---------------------------------------------------------------------------

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

function repoBase(info: RemoteInfo): string {
  return `${info.apiUrl}/api/v1/repos/${info.ownerId}/${info.repoName}`
}

class HttpError extends Error {
  constructor(
    readonly method: string,
    readonly url: string,
    readonly status: number,
    readonly responseText: string,
  ) {
    super(`${method} ${url} -> ${status}: ${responseText}`)
  }
}

async function apiPost<T>(url: string, token: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new HttpError('POST', url, res.status, text)
  }
  return res.json() as Promise<T>
}

function isUnsupportedEndpoint(err: unknown): boolean {
  return err instanceof HttpError && (err.status === 404 || err.status === 405)
}

// ---------------------------------------------------------------------------
// Remote refs
// ---------------------------------------------------------------------------

export interface RemoteRef {
  name: string
  commitHash: string
  type: 'branch' | 'tag'
  isImmutable: boolean
}

export interface PushCertificate {
  payload: {
    refName: string
    oldHash: string | null
    newHash: string
    pusher: string
    timestamp: number
    nonce: string
  }
  signature: string
  publicKey: string
}

/** Fetch all refs for a remote repository. Returns [] on error. */
export async function getRemoteRefs(info: RemoteInfo, token: string): Promise<RemoteRef[]> {
  try {
    const res = await fetch(`${repoBase(info)}/refs`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return []
    const raw = (await res.json() as { refs?: unknown[] }).refs ?? []
    return raw.filter((r): r is RemoteRef =>
      r !== null &&
      typeof r === 'object' &&
      typeof (r as RemoteRef).name === 'string' &&
      SAFE_REF_NAME.test((r as RemoteRef).name) &&
      typeof (r as RemoteRef).commitHash === 'string' &&
      HASH_RE.test((r as RemoteRef).commitHash)
    )
  } catch {
    return []
  }
}

/**
 * Update (or create) a remote ref with optional CAS.
 * Throws on 409 conflict or other errors.
 */
export async function updateRemoteRef(
  info: RemoteInfo,
  token: string,
  refName: string,           // e.g. "heads/main"
  commitHash: string,
  expectedHash?: string | null,
  pushCertificate?: PushCertificate,
): Promise<void> {
  const url = `${repoBase(info)}/refs/${refName}`
  const body: Record<string, unknown> = { commitHash }
  if (expectedHash !== undefined) body.expectedHash = expectedHash
  if (pushCertificate) body.pushCertificate = pushCertificate

  const res = await fetch(url, {
    method: 'PUT',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string; currentHash?: string }
    const msg = data.error ?? `HTTP ${res.status}`
    throw new Error(
      res.status === 409
        ? `Push rejected (non-fast-forward): ${msg}. Run 'rekurn pull' first.`
        : `Failed to update remote ref: ${msg}`,
    )
  }
}

// ---------------------------------------------------------------------------
// Want / have negotiation
// ---------------------------------------------------------------------------

/**
 * Given a set of hashes, return the subset the server is missing.
 */
export async function getMissingFromRemote(
  info: RemoteInfo,
  token: string,
  hashes: string[],
): Promise<string[]> {
  if (hashes.length === 0) return []
  const missing: string[] = []

  for (let i = 0; i < hashes.length; i += HASH_CHUNK_SIZE) {
    const chunk = hashes.slice(i, i + HASH_CHUNK_SIZE)
    const data = await apiPost<{ missing: string[] }>(
      `${repoBase(info)}/objects/want`,
      token,
      { hashes: chunk },
    )
    missing.push(...data.missing)
  }

  return missing
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

/**
 * Upload a single object (base64-encoded) to the remote.
 */
export async function uploadObject(
  info: RemoteInfo,
  token: string,
  hash: string,
  bytes: Buffer,
): Promise<void> {
  await apiPost(`${repoBase(info)}/objects/upload`, token, {
    hash,
    data: bytes.toString('base64'),
  })
}

export async function uploadObjects(
  info: RemoteInfo,
  token: string,
  repoRoot: string,
  hashes: string[],
  onProgress?: (uploaded: number) => void,
  onMissingLocal?: (hash: string) => void,
): Promise<number> {
  let uploaded = 0
  let batchSupported = true
  let batch: Array<{ hash: string; bytes: Buffer }> = []
  let batchRequestBytes = 16

  async function flushBatch(): Promise<void> {
    if (batch.length === 0) return
    const current = batch
    batch = []
    batchRequestBytes = 16

    if (batchSupported) {
      try {
        await uploadObjectBatch(info, token, current)
        uploaded += current.length
        onProgress?.(uploaded)
        return
      } catch (err) {
        if (!isUnsupportedEndpoint(err)) throw err
        batchSupported = false
      }
    }

    await mapLimit(current, SINGLE_TRANSFER_CONCURRENCY, async (item) => {
      await uploadObject(info, token, item.hash, item.bytes)
    })
    uploaded += current.length
    onProgress?.(uploaded)
  }

  for (const hash of hashes) {
    const bytes = readObjectFromCache(repoRoot, hash)
    if (!bytes) {
      onMissingLocal?.(hash)
      continue
    }

    const requestBytes = estimatedBatchObjectBytes(bytes)
    if (requestBytes > MAX_BATCH_REQUEST_BYTES) {
      await flushBatch()
      await uploadObject(info, token, hash, bytes)
      uploaded++
      onProgress?.(uploaded)
      continue
    }

    if (batch.length > 0 && batchRequestBytes + requestBytes > MAX_BATCH_REQUEST_BYTES) {
      await flushBatch()
    }

    batch.push({ hash, bytes })
    batchRequestBytes += requestBytes
  }

  await flushBatch()
  return uploaded
}

function estimatedBatchObjectBytes(bytes: Buffer): number {
  return Math.ceil(bytes.length / 3) * 4 + 90
}

async function uploadObjectBatch(
  info: RemoteInfo,
  token: string,
  objects: Array<{ hash: string; bytes: Buffer }>,
): Promise<void> {
  await apiPost(`${repoBase(info)}/objects/upload-batch`, token, {
    objects: objects.map((object) => ({
      hash: object.hash,
      data: object.bytes.toString('base64'),
    })),
  })
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

/**
 * Download a single object from the remote.
 * Returns null if not found.
 */
export async function downloadObject(
  info: RemoteInfo,
  token: string,
  hash: string,
): Promise<Buffer | null> {
  try {
    const res = await fetch(`${repoBase(info)}/objects/${hash}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.status === 404) return null
    if (!res.ok) return null
    const data = await res.json() as { data: string }
    return Buffer.from(data.data, 'base64')
  } catch {
    return null
  }
}

async function downloadObjectsBatch(
  info: RemoteInfo,
  token: string,
  hashes: string[],
): Promise<Map<string, Buffer>> {
  const data = await apiPost<{
    objects: Array<{ hash: string; data: string }>
    missing: string[]
  }>(`${repoBase(info)}/objects/batch`, token, { hashes })

  const objects = new Map<string, Buffer>()
  for (const object of data.objects) {
    objects.set(object.hash, Buffer.from(object.data, 'base64'))
  }
  return objects
}

// ---------------------------------------------------------------------------
// Collect objects for push (BFS from local commit, stop at known remote commit)
// ---------------------------------------------------------------------------

function collectTreeObjects(
  repoRoot: string,
  treeHash: string,
  acc: Set<string>,
): void {
  if (acc.has(treeHash)) return
  const bytes = readObjectFromCache(repoRoot, treeHash)
  if (!bytes) return

  acc.add(treeHash)

  const tree = parseTree(bytes)
  for (const entry of tree.entries) {
    if (entry.mode === '040000') {
      collectTreeObjects(repoRoot, entry.hash, acc)
    } else {
      acc.add(entry.hash)
    }
  }
}

/**
 * Collect all object hashes reachable from `localHead` that are NOT reachable
 * from `remoteHead` (i.e. the objects that need to be pushed).
 *
 * Returns a Set of all hashes (commits + trees + blobs) to upload.
 */
export function collectObjectsForPush(
  repoRoot: string,
  localHead: string,
  remoteHead: string | null,
): Set<string> {
  const result = new Set<string>()
  const visited = new Set<string>()
  const queue: string[] = [localHead]

  while (queue.length > 0) {
    const hash = queue.pop()!
    if (visited.has(hash) || hash === remoteHead) continue
    visited.add(hash)

    const bytes = readObjectFromCache(repoRoot, hash)
    if (!bytes) continue

    try {
      const type = detectObjectType(bytes)
      if (type !== 'commit') continue

      result.add(hash) // commit
      const commit = parseCommit(bytes)

      // Collect tree objects recursively
      collectTreeObjects(repoRoot, commit.treeHash, result)

      // Queue parent commits
      for (const parent of commit.parentHashes) {
        if (!visited.has(parent) && parent !== remoteHead) {
          queue.push(parent)
        }
      }
    } catch {
      // Skip objects we can't parse
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Fetch (BFS download from remote)
// ---------------------------------------------------------------------------

/**
 * Download all objects reachable from `startHashes` that are not already in
 * the local cache.  Traverses commit parents and tree entries recursively.
 *
 * Reports progress via the optional `onProgress` callback.
 */
export async function fetchObjects(
  info: RemoteInfo,
  token: string,
  repoRoot: string,
  startHashes: string[],
  onProgress?: (downloaded: number) => void,
): Promise<number> {
  const pending = [...startHashes]
  const enqueued = new Set<string>(startHashes)
  let downloaded = 0
  let batchSupported = true

  while (pending.length > 0) {
    const hashes: string[] = []
    while (pending.length > 0 && hashes.length < HASH_CHUNK_SIZE) {
      const hash = pending.pop()!
      if (!readObjectFromCache(repoRoot, hash)) hashes.push(hash)
    }

    if (hashes.length === 0) {
      continue
    }

    let objects: Map<string, Buffer>
    if (batchSupported) {
      try {
        objects = await downloadObjectsBatch(info, token, hashes)
      } catch (err) {
        if (!isUnsupportedEndpoint(err)) throw err
        batchSupported = false
        objects = await downloadObjectsIndividually(info, token, hashes)
      }
    } else {
      objects = await downloadObjectsIndividually(info, token, hashes)
    }

    for (const hash of hashes) {
      const bytes = objects.get(hash)
      if (!bytes) {
        console.warn(`  warn: object ${hash.slice(0, 12)}... not found on remote`)
        continue
      }

      // Verify integrity before caching
      const actual = createHash('sha256').update(bytes).digest('hex')
      if (actual !== hash) {
        console.warn(`  warn: object ${hash.slice(0, 12)}... hash mismatch — skipping`)
        continue
      }

      writeObjectToCache(repoRoot, hash, bytes)
      downloaded++
      onProgress?.(downloaded)

      // Traverse the object graph
      try {
        const type = detectObjectType(bytes)
        if (type === 'commit') {
          const commit = parseCommit(bytes)
          enqueue(commit.treeHash, pending, enqueued)
          for (const parent of commit.parentHashes) enqueue(parent, pending, enqueued)
        } else if (type === 'tree') {
          const tree = parseTree(bytes)
          for (const entry of tree.entries) enqueue(entry.hash, pending, enqueued)
        }
        // Blobs: no further traversal needed
      } catch {
        // Unknown object type or parse error — skip traversal
      }
    }
  }

  return downloaded
}

async function downloadObjectsIndividually(
  info: RemoteInfo,
  token: string,
  hashes: string[],
): Promise<Map<string, Buffer>> {
  const rows = await mapLimit(hashes, SINGLE_TRANSFER_CONCURRENCY, async (hash) => ({
    hash,
    bytes: await downloadObject(info, token, hash),
  }))
  const objects = new Map<string, Buffer>()
  for (const row of rows) {
    if (row.bytes) objects.set(row.hash, row.bytes)
  }
  return objects
}

function enqueue(hash: string, pending: string[], enqueued: Set<string>): void {
  if (!enqueued.has(hash)) {
    enqueued.add(hash)
    pending.push(hash)
  }
}
