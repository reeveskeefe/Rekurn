import { describe, expect, it } from 'vitest'
import { diffLines, type LineEdit } from '../myers.js'
import { threeWayMerge, type MergeFileEntry } from '../three-way.js'

describe('diffLines', () => {
  it('reconstructs representative small edits', () => {
    const oldText = ['a', 'b', 'c', 'd'].join('\n')
    const newText = ['a', 'b2', 'c', 'e'].join('\n')

    expect(applyNew(diffLines(oldText, newText))).toBe(newText)
  })

  it('uses anchored windows for large files without changing patch meaning', () => {
    const oldLines = Array.from({ length: 2_600 }, (_, i) => `line ${i}`)
    const newLines = [...oldLines]
    newLines.splice(900, 3, 'line 900 changed', 'line 901 changed')
    newLines.splice(2_100, 0, 'inserted stable block')

    const newText = newLines.join('\n')
    expect(applyNew(diffLines(oldLines.join('\n'), newText))).toBe(newText)
  })
})

describe('threeWayMerge', () => {
  it('does not load clean same-hash content just to compare entries', () => {
    const base = new Map<string, MergeFileEntry>()
    const ours = new Map<string, MergeFileEntry>([
      ['a.txt', lazyEntry('a.txt', 'a'.repeat(64), () => { throw new Error('should not load ours') })],
    ])
    const theirs = new Map<string, MergeFileEntry>([
      ['a.txt', lazyEntry('a.txt', 'a'.repeat(64), () => { throw new Error('should not load theirs') })],
    ])

    const result = threeWayMerge(base, ours, theirs)
    expect(result.conflicts).toHaveLength(0)
    expect(result.files.get('a.txt')?.hash).toBe('a'.repeat(64))
  })

  it('loads lazy content only for conflict markers', () => {
    const base = new Map<string, MergeFileEntry>([
      ['a.txt', lazyEntry('a.txt', 'a'.repeat(64), () => Buffer.from('base'))],
    ])
    const ours = new Map<string, MergeFileEntry>([
      ['a.txt', lazyEntry('a.txt', 'b'.repeat(64), () => Buffer.from('ours'))],
    ])
    const theirs = new Map<string, MergeFileEntry>([
      ['a.txt', lazyEntry('a.txt', 'c'.repeat(64), () => Buffer.from('theirs'))],
    ])

    const result = threeWayMerge(base, ours, theirs)
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0]!.content.toString('utf8')).toContain('<<<<<<< HEAD')
  })
})

function applyNew(edits: LineEdit[]): string {
  const lines: string[] = []
  for (const edit of edits) {
    if (edit.type !== 'delete') lines.push(...edit.lines)
  }
  return lines.join('\n')
}

function lazyEntry(path: string, hash: string, content: () => Buffer): MergeFileEntry {
  return { path, hash, mode: '100644', content }
}
