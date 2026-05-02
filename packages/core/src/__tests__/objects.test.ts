import { describe, it, expect } from 'vitest'
import { createBlob, hashBlob, serializeBlob } from '../blob.js'
import { createTree, hashTree, buildTreeFromPaths, serializeTree } from '../tree.js'
import { createCommit, hashCommit, serializeCommitBody } from '../commit.js'
import type { CommitData } from '@rekurn/types'

// ---------------------------------------------------------------------------
// Blob
// ---------------------------------------------------------------------------

describe('createBlob', () => {
  it('returns a blob object with correct type, size, and 64-char hash', () => {
    const content = Buffer.from('hello rekurn')
    const blob = createBlob(content)
    expect(blob.type).toBe('blob')
    expect(blob.size).toBe(content.length)
    expect(blob.hash).toHaveLength(64)
    expect(blob.hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic — same content produces same hash', () => {
    const content = Buffer.from('const x = 1')
    expect(createBlob(content).hash).toBe(createBlob(content).hash)
  })

  it('different content produces different hash', () => {
    expect(createBlob(Buffer.from('a')).hash).not.toBe(createBlob(Buffer.from('b')).hash)
  })

  it('hashBlob matches createBlob hash', () => {
    const content = Buffer.from('test file content')
    expect(hashBlob(content)).toBe(createBlob(content).hash)
  })

  it('serializeBlob round-trips', () => {
    const content = Buffer.from('file data')
    const blob = createBlob(content)
    const serialized = serializeBlob(blob, content)
    expect(serialized.includes(content)).toBe(true)
    expect(serialized.toString()).toContain('rekurn-blob')
  })
})

// ---------------------------------------------------------------------------
// Tree
// ---------------------------------------------------------------------------

describe('createTree', () => {
  it('returns a tree object with correct type and 64-char hash', () => {
    const tree = createTree([
      { mode: '100644', name: 'index.ts', hash: 'a'.repeat(64) },
    ])
    expect(tree.type).toBe('tree')
    expect(tree.hash).toHaveLength(64)
    expect(tree.entries).toHaveLength(1)
  })

  it('sorts entries by name regardless of insertion order', () => {
    const t1 = createTree([
      { mode: '100644', name: 'zebra.ts', hash: 'b'.repeat(64) },
      { mode: '100644', name: 'alpha.ts', hash: 'a'.repeat(64) },
    ])
    const t2 = createTree([
      { mode: '100644', name: 'alpha.ts', hash: 'a'.repeat(64) },
      { mode: '100644', name: 'zebra.ts', hash: 'b'.repeat(64) },
    ])
    expect(t1.hash).toBe(t2.hash)
    expect(t1.entries[0]!.name).toBe('alpha.ts')
  })

  it('is deterministic', () => {
    const entries = [{ mode: '100644' as const, name: 'file.ts', hash: 'c'.repeat(64) }]
    expect(hashTree(entries)).toBe(hashTree(entries))
  })

  it('empty tree has a stable hash', () => {
    const t = createTree([])
    expect(t.hash).toHaveLength(64)
  })

  it('serializeTree produces parsable bytes', () => {
    const tree = createTree([{ mode: '100644', name: 'a.ts', hash: 'd'.repeat(64) }])
    const bytes = serializeTree(tree)
    expect(bytes.toString()).toContain('rekurn-tree')
    expect(bytes.toString()).toContain('a.ts')
  })
})

// ---------------------------------------------------------------------------
// buildTreeFromPaths
// ---------------------------------------------------------------------------

describe('buildTreeFromPaths', () => {
  it('builds a root tree from a flat list', () => {
    const { rootTree, allTrees } = buildTreeFromPaths([
      { path: 'package.json', hash: 'a'.repeat(64), mode: '100644' },
      { path: 'src/index.ts', hash: 'b'.repeat(64), mode: '100644' },
      { path: 'src/lib/repo.ts', hash: 'c'.repeat(64), mode: '100644' },
    ])
    // root, src/, src/lib/ → 3 trees
    expect(allTrees).toHaveLength(3)
    // Root should have package.json + src/ directory entry
    const rootEntryNames = rootTree.entries.map((e) => e.name)
    expect(rootEntryNames).toContain('package.json')
    expect(rootEntryNames).toContain('src')
    // src entry should be a directory (040000)
    const srcEntry = rootTree.entries.find((e) => e.name === 'src')
    expect(srcEntry?.mode).toBe('040000')
  })

  it('is deterministic across different insertion orders', () => {
    const entries = [
      { path: 'src/index.ts', hash: 'b'.repeat(64), mode: '100644' as const },
      { path: 'package.json', hash: 'a'.repeat(64), mode: '100644' as const },
    ]
    const r1 = buildTreeFromPaths(entries)
    const r2 = buildTreeFromPaths([...entries].reverse())
    expect(r1.rootTree.hash).toBe(r2.rootTree.hash)
  })
})

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

const sampleCommitData: CommitData = {
  treeHash: 'e'.repeat(64),
  parentHashes: [],
  author: { name: 'Keefe Reeves', email: 'keefe@oreulius.com', timestamp: 1746172800 },
  committer: { name: 'Keefe Reeves', email: 'keefe@oreulius.com', timestamp: 1746172800 },
  message: 'initial commit',
}

describe('createCommit', () => {
  it('returns a commit object with correct type and 64-char hash', () => {
    const commit = createCommit(sampleCommitData)
    expect(commit.type).toBe('commit')
    expect(commit.hash).toHaveLength(64)
    expect(commit.hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic', () => {
    expect(createCommit(sampleCommitData).hash).toBe(createCommit(sampleCommitData).hash)
  })

  it('different messages produce different hashes', () => {
    const c1 = createCommit({ ...sampleCommitData, message: 'first' })
    const c2 = createCommit({ ...sampleCommitData, message: 'second' })
    expect(c1.hash).not.toBe(c2.hash)
  })

  it('different parent lists produce different hashes', () => {
    const c1 = createCommit({ ...sampleCommitData, parentHashes: [] })
    const c2 = createCommit({
      ...sampleCommitData,
      parentHashes: ['f'.repeat(64)],
    })
    expect(c1.hash).not.toBe(c2.hash)
  })

  it('hashCommit matches createCommit hash', () => {
    expect(hashCommit(sampleCommitData)).toBe(createCommit(sampleCommitData).hash)
  })
})

describe('serializeCommitBody', () => {
  it('contains tree, author, committer, and message', () => {
    const body = serializeCommitBody(sampleCommitData)
    expect(body).toContain(`tree ${'e'.repeat(64)}`)
    expect(body).toContain('author Keefe Reeves <keefe@oreulius.com>')
    expect(body).toContain('committer Keefe Reeves <keefe@oreulius.com>')
    expect(body).toContain('initial commit')
  })

  it('includes parent lines for each parent hash', () => {
    const data: CommitData = {
      ...sampleCommitData,
      parentHashes: ['1'.repeat(64), '2'.repeat(64)],
    }
    const body = serializeCommitBody(data)
    expect(body).toContain(`parent ${'1'.repeat(64)}`)
    expect(body).toContain(`parent ${'2'.repeat(64)}`)
  })
})
