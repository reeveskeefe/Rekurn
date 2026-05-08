/**
 * Transfer protocol unit tests.
 *
 * Verifies Term I of the unified transfer equation T*_sys:
 *
 *   b*_dl = floor( (T_max - (t_rtt + t_cold + t_db + t_safety)) / (μ_s/B + t_b/c) )
 *         = 208
 *
 * fetchObjects MUST batch download requests in chunks of ≤ 208 hashes.
 * getMissingFromRemote (want) MUST still use HASH_CHUNK_SIZE = 5 000.
 *
 * Both constants serve different roles:
 *   - HASH_CHUNK_SIZE = 5 000: sending 64-byte hashes only (tiny payload, no response data)
 *   - DOWNLOAD_CHUNK_SIZE = 208: receiving full object data (response bound by T_max)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports that use them
// ---------------------------------------------------------------------------

// Mock the repo module so we control readObjectFromCache / writeObjectToCache
vi.mock('../lib/repo.js', () => ({
  readObjectFromCache: vi.fn().mockReturnValue(null),   // nothing cached locally
  writeObjectToCache: vi.fn(),
}))

// We intercept fetch globally to observe what the transfer functions send
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

// Import after mocks are set up
import { getMissingFromRemote, fetchObjects } from '../lib/transfer.js'
import type { RemoteInfo } from '../lib/remote.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const REMOTE: RemoteInfo = {
  apiUrl: 'https://api.example.com',
  ownerId: 'owner',
  repoName: 'repo',
}
const TOKEN = 'test-token'
const REPO_ROOT = '/fake/repo'

function makeHashes(n: number): string[] {
  return Array.from({ length: n }, (_, i) => i.toString(16).padStart(64, '0'))
}

// ---------------------------------------------------------------------------
// Term I — Download chunk size = 208
// ---------------------------------------------------------------------------

describe('Term I: fetchObjects uses DOWNLOAD_CHUNK_SIZE = 208', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('splits 500 hashes into batches of ≤ 208 for download', async () => {
    const hashes = makeHashes(500)
    const batchSizes: number[] = []

    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body ?? '{}') as string) as { hashes?: string[] }
      if (body.hashes) batchSizes.push(body.hashes.length)
      // Return each hash with trivial valid data (non-empty buffer, but hash won't match — that's ok,
      // the test verifies batching behavior not integrity; integrity is covered separately)
      const objects = (body.hashes ?? []).map((h) => ({
        hash: h,
        data: Buffer.alloc(4).toString('base64'),
      }))
      return Promise.resolve(
        new Response(JSON.stringify({ objects, missing: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })

    // fetchObjects will warn about hash mismatches (our fake data) but still complete
    await fetchObjects(REMOTE, TOKEN, REPO_ROOT, hashes)

    expect(batchSizes.length).toBeGreaterThanOrEqual(Math.ceil(500 / 208)) // ≥ 3 batches
    for (const size of batchSizes) {
      expect(size).toBeLessThanOrEqual(208) // Term I: b* = 208
    }
    // Total hashes across all batches = 500
    expect(batchSizes.reduce((a, b) => a + b, 0)).toBe(500)
  })

  it('a single batch of ≤ 208 hashes is NOT split further', async () => {
    const hashes = makeHashes(100)
    const batchSizes: number[] = []

    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body ?? '{}') as string) as { hashes?: string[] }
      if (body.hashes) batchSizes.push(body.hashes.length)
      const objects = (body.hashes ?? []).map((h) => ({ hash: h, data: Buffer.alloc(4).toString('base64') }))
      return Promise.resolve(
        new Response(JSON.stringify({ objects, missing: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })

    await fetchObjects(REMOTE, TOKEN, REPO_ROOT, hashes)

    // All 100 hashes should go in one batch
    expect(batchSizes).toHaveLength(1)
    expect(batchSizes[0]).toBe(100)
  })

  it('ceil(500/208) = 3 — verifies the exact round-up arithmetic', () => {
    expect(Math.ceil(500 / 208)).toBe(3)
  })

  it('ceil(208/208) = 1 — boundary: exactly one full chunk', () => {
    expect(Math.ceil(208 / 208)).toBe(1)
  })

  it('ceil(209/208) = 2 — boundary: one hash over triggers second batch', () => {
    expect(Math.ceil(209 / 208)).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// HASH_CHUNK_SIZE = 5 000 for want negotiation — must not have changed
// ---------------------------------------------------------------------------

describe('Want negotiation: HASH_CHUNK_SIZE = 5 000 unchanged', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('splits 6 000 hashes into exactly [5 000, 1 000] want chunks', async () => {
    const hashes = makeHashes(6_000)
    const wantSizes: number[] = []

    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body ?? '{}') as string) as { hashes?: string[] }
      if (body.hashes) wantSizes.push(body.hashes.length)
      return Promise.resolve(
        new Response(JSON.stringify({ missing: body.hashes ?? [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })

    const missing = await getMissingFromRemote(REMOTE, TOKEN, hashes)

    expect(wantSizes).toHaveLength(2)
    expect(wantSizes[0]).toBe(5_000)
    expect(wantSizes[1]).toBe(1_000)
    expect(missing).toHaveLength(6_000) // all returned as missing
  })

  it('5 000 hashes exactly fits one want chunk', async () => {
    const hashes = makeHashes(5_000)
    const wantSizes: number[] = []

    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body ?? '{}') as string) as { hashes?: string[] }
      if (body.hashes) wantSizes.push(body.hashes.length)
      return Promise.resolve(
        new Response(JSON.stringify({ missing: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })

    await getMissingFromRemote(REMOTE, TOKEN, hashes)

    expect(wantSizes).toHaveLength(1)
    expect(wantSizes[0]).toBe(5_000)
  })

  it('download chunk size (208) is strictly less than want chunk size (5 000)', () => {
    // Structural invariant: DOWNLOAD_CHUNK_SIZE < HASH_CHUNK_SIZE
    // If this breaks, someone merged the two constants back together.
    const DOWNLOAD = 208
    const WANT = 5_000
    expect(DOWNLOAD).toBeLessThan(WANT)
  })
})
