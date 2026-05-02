/**
 * Object transfer protocol for the Rekurn CLI.
 *
 * Handles push (collect → want → upload) and fetch (download + BFS) logic,
 * keeping all raw HTTP details in one place.
 */

import { parseCommit, parseTree, detectObjectType } from '@rekurn/core'
import { readObjectFromCache, writeObjectToCache } from './repo.js'
import type { RemoteInfo } from './remote.js'

// ---------------------------------------------------------------------------
// Internal HTTP helpers
// ---------------------------------------------------------------------------

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

function repoBase(info: RemoteInfo): string {
  return `${info.apiUrl}/api/v1/repos/${info.ownerId}/${info.repoName}`
}

async function apiPost<T>(url: string, token: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`POST ${url} → ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
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

/** Fetch all refs for a remote repository. Returns [] on error. */
export async function getRemoteRefs(info: RemoteInfo, token: string): Promise<RemoteRef[]> {
  try {
    const res = await fetch(`${repoBase(info)}/refs`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return []
    const data = await res.json() as { refs: RemoteRef[] }
    return data.refs ?? []
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
): Promise<void> {
  const url = `${repoBase(info)}/refs/${refName}`
  const body: Record<string, unknown> = { commitHash }
  if (expectedHash !== undefined) body.expectedHash = expectedHash

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
  const data = await apiPost<{ missing: string[] }>(
    `${repoBase(info)}/objects/want`,
    token,
    { hashes },
  )
  return data.missing
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

  while (pending.length > 0) {
    const hash = pending.pop()!

    // Already in local cache?
    if (readObjectFromCache(repoRoot, hash)) {
      continue
    }

    const bytes = await downloadObject(info, token, hash)
    if (!bytes) {
      console.warn(`  warn: object ${hash.slice(0, 12)}… not found on remote`)
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

  return downloaded
}

function enqueue(hash: string, pending: string[], enqueued: Set<string>): void {
  if (!enqueued.has(hash)) {
    enqueued.add(hash)
    pending.push(hash)
  }
}
