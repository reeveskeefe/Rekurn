/**
 * Unit tests for storeObjectBatch — the critical upload-batch optimization.
 *
 * storeObjectBatch must:
 *   1. Issue exactly ONE SELECT (inArray) regardless of item count.
 *   2. Issue Blob PUT only for genuinely new objects (skip existing).
 *   3. Issue exactly ONE batch INSERT for all new objects.
 *   4. Issue a commit-table INSERT for objects whose type is 'commit'.
 *   5. Do nothing (no DB calls) when given an empty list.
 *   6. Do nothing (no PUTs, no INSERT) when all objects already exist.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks — must be set up before any import that triggers module load
// ---------------------------------------------------------------------------

const {
  mockPut,
  mockSelect,
  mockInsert,
  mockWhere,
  mockValues,
  mockOnConflictDoNothing,
  mockDetectObjectType,
  mockParseCommit,
} = vi.hoisted(() => {
  // Drizzle SELECT chain: db.select(...).from(...).where(...) → Promise<rows>
  const mockWhere = vi.fn().mockResolvedValue([])
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
  const mockSelect = vi.fn().mockReturnValue({ from: mockFrom })

  // Drizzle INSERT chain: db.insert(...).values(...).onConflictDoNothing() → Promise<void>
  const mockOnConflictDoNothing = vi.fn().mockResolvedValue(undefined)
  const mockValues = vi.fn().mockReturnValue({ onConflictDoNothing: mockOnConflictDoNothing })
  const mockInsert = vi.fn().mockReturnValue({ values: mockValues })

  // Vercel Blob
  const mockPut = vi.fn().mockResolvedValue({ url: 'https://test.blob.vercel-storage.com/obj' })

  // @rekurn/core
  const mockDetectObjectType = vi.fn().mockReturnValue('blob')
  const mockParseCommit = vi.fn().mockReturnValue({
    treeHash: 'f'.repeat(64),
    parentHashes: [],
    author: { name: 'Test', email: 'test@example.com', timestamp: 1_000_000 },
    committer: { name: 'Test', email: 'test@example.com', timestamp: 1_000_000 },
    message: 'test commit',
    signature: null,
  })

  return {
    mockPut,
    mockSelect,
    mockInsert,
    mockWhere,
    mockValues,
    mockOnConflictDoNothing,
    mockDetectObjectType,
    mockParseCommit,
  }
})

vi.mock('@rekurn/db', () => ({
  db: { select: mockSelect, insert: mockInsert },
  objects: {},
  commits: {},
}))

vi.mock('@vercel/blob', () => ({
  put: mockPut,
  get: vi.fn(),
}))

vi.mock('@rekurn/core', () => ({
  detectObjectType: mockDetectObjectType,
  parseCommit: mockParseCommit,
  computeObjectHash: vi.fn(),
}))

// Import AFTER mocks are registered
import { storeObjectBatch } from '../objects'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHash(char: string): string {
  return char.repeat(64)
}

function makeItem(char: string, content = 'data'): { hash: string; bytes: Buffer } {
  return { hash: makeHash(char), bytes: Buffer.from(content) }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('storeObjectBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: no existing hashes in DB
    mockWhere.mockResolvedValue([])
    // Default: all objects are blobs
    mockDetectObjectType.mockReturnValue('blob')
  })

  it('empty input — no DB calls at all', async () => {
    await storeObjectBatch('repo-1', [])

    expect(mockSelect).not.toHaveBeenCalled()
    expect(mockPut).not.toHaveBeenCalled()
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('all objects already exist — one SELECT, no PUTs, no INSERT', async () => {
    const a = makeItem('a')
    const b = makeItem('b')
    mockWhere.mockResolvedValue([{ hash: a.hash }, { hash: b.hash }])

    await storeObjectBatch('repo-1', [a, b])

    // Exactly one SELECT regardless of item count — this is the whole point
    expect(mockSelect).toHaveBeenCalledTimes(1)
    expect(mockPut).not.toHaveBeenCalled()
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('all new objects — one SELECT, one PUT per object, one batch INSERT', async () => {
    const a = makeItem('a')
    const b = makeItem('b')
    const c = makeItem('c')

    await storeObjectBatch('repo-1', [a, b, c])

    expect(mockSelect).toHaveBeenCalledTimes(1)   // single existence check
    expect(mockPut).toHaveBeenCalledTimes(3)       // one PUT per new object
    expect(mockInsert).toHaveBeenCalledTimes(1)    // exactly one batch INSERT
  })

  it('mixed — only new objects get PUT and appear in INSERT', async () => {
    const existing = makeItem('a')
    const newObj = makeItem('b', 'new-content')
    mockWhere.mockResolvedValue([{ hash: existing.hash }])

    await storeObjectBatch('repo-1', [existing, newObj])

    expect(mockPut).toHaveBeenCalledTimes(1)
    expect(mockPut).toHaveBeenCalledWith(
      `rekurn/objects/${newObj.hash}`,
      newObj.bytes,
      expect.objectContaining({ addRandomSuffix: false }),
    )

    // INSERT values array must contain only the new object
    const insertedValues: Array<{ hash: string }> = mockValues.mock.calls[0][0]
    expect(insertedValues).toHaveLength(1)
    expect(insertedValues[0]).toMatchObject({ hash: newObj.hash })
  })

  it('Blob PUT uses the correct content-addressed path', async () => {
    const item = makeItem('d', 'payload')

    await storeObjectBatch('repo-1', [item])

    expect(mockPut).toHaveBeenCalledWith(
      `rekurn/objects/${item.hash}`,
      item.bytes,
      expect.objectContaining({ addRandomSuffix: false, access: 'private' }),
    )
  })

  it('commit objects trigger a second INSERT into the commits table', async () => {
    const commitItem = makeItem('e', 'commit-bytes')
    mockDetectObjectType.mockReturnValue('commit')

    await storeObjectBatch('repo-1', [commitItem])

    // INSERT called twice: once for objects table, once for commits table (via storeCommitRecord)
    expect(mockInsert).toHaveBeenCalledTimes(2)
    expect(mockPut).toHaveBeenCalledTimes(1)
  })

  it('batch INSERT is called exactly once even for many objects', async () => {
    const items = Array.from({ length: 50 }, (_, i) =>
      makeItem(i.toString(16).padStart(1, '0')[0]!, `content-${i}`),
    )

    await storeObjectBatch('repo-1', items)

    // The whole point: 1 SELECT + 50 PUTs + 1 INSERT, not 50 × (SELECT + PUT + INSERT)
    expect(mockSelect).toHaveBeenCalledTimes(1)
    expect(mockInsert).toHaveBeenCalledTimes(1)
    expect(mockPut).toHaveBeenCalledTimes(50)
  })
})
