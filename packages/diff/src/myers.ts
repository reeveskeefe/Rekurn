import { diffLines as _diffLines, diffWords as _diffWords, applyPatch } from 'diff'

const HYBRID_LINE_THRESHOLD = 2_000
const MYERS_WINDOW_LIMIT = 1_200

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type EditType = 'equal' | 'insert' | 'delete'

export interface LineEdit {
  type: EditType
  /** Lines (including trailing newline where present). */
  lines: string[]
  /** 1-based line number in the OLD file (for 'equal' and 'delete'). */
  oldStart: number
  /** 1-based line number in the NEW file (for 'equal' and 'insert'). */
  newStart: number
}

export interface WordEdit {
  type: EditType
  value: string
}

// ---------------------------------------------------------------------------
// Line-level diff  (wraps the battle-tested `diff` package)
// ---------------------------------------------------------------------------

/**
 * Compute a line-level diff between two strings.
 * Returns a list of edits with bookkeeping for old/new line numbers.
 */
export function diffLines(oldText: string, newText: string): LineEdit[] {
  const oldLines = splitLines(oldText)
  const newLines = splitLines(newText)

  if (oldLines.length + newLines.length < HYBRID_LINE_THRESHOLD) {
    return myersDiffLines(oldLines, newLines, 1, 1)
  }

  return hybridDiffLines(oldLines, newLines)
}

function myersDiffLines(
  oldLines: string[],
  newLines: string[],
  oldStart: number,
  newStart: number,
): LineEdit[] {
  const changes = _diffLines(linesToText(oldLines), linesToText(newLines), { newlineIsToken: false })
  const result: LineEdit[] = []
  let oldLine = oldStart
  let newLine = newStart

  for (const change of changes) {
    const lines = change.value.split('\n')
    // `diff` includes a trailing empty string when the value ends with '\n'
    if (lines[lines.length - 1] === '') lines.pop()

    const count = lines.length
    const type: EditType = change.added ? 'insert' : change.removed ? 'delete' : 'equal'

    result.push({ type, lines, oldStart: oldLine, newStart: newLine })

    if (type !== 'insert') oldLine += count
    if (type !== 'delete') newLine += count
  }

  return result
}

function hybridDiffLines(oldLines: string[], newLines: string[]): LineEdit[] {
  const anchors = patienceAnchors(oldLines, newLines)
  if (anchors.length === 0) {
    return fallbackWindow(oldLines, newLines, 0, 0)
  }

  const result: LineEdit[] = []
  let oldCursor = 0
  let newCursor = 0

  for (const anchor of anchors) {
    appendEdits(result, fallbackWindow(
      oldLines.slice(oldCursor, anchor.oldIndex),
      newLines.slice(newCursor, anchor.newIndex),
      oldCursor,
      newCursor,
    ))

    pushEdit(result, {
      type: 'equal',
      lines: [oldLines[anchor.oldIndex]!],
      oldStart: anchor.oldIndex + 1,
      newStart: anchor.newIndex + 1,
    })

    oldCursor = anchor.oldIndex + 1
    newCursor = anchor.newIndex + 1
  }

  appendEdits(result, fallbackWindow(
    oldLines.slice(oldCursor),
    newLines.slice(newCursor),
    oldCursor,
    newCursor,
  ))

  return result
}

function fallbackWindow(
  oldLines: string[],
  newLines: string[],
  oldOffset: number,
  newOffset: number,
): LineEdit[] {
  if (oldLines.length === 0 && newLines.length === 0) return []
  if (oldLines.length + newLines.length <= MYERS_WINDOW_LIMIT) {
    return myersDiffLines(oldLines, newLines, oldOffset + 1, newOffset + 1)
  }

  const result: LineEdit[] = []
  if (oldLines.length > 0) {
    pushEdit(result, {
      type: 'delete',
      lines: oldLines,
      oldStart: oldOffset + 1,
      newStart: newOffset + 1,
    })
  }
  if (newLines.length > 0) {
    pushEdit(result, {
      type: 'insert',
      lines: newLines,
      oldStart: oldOffset + oldLines.length + 1,
      newStart: newOffset + 1,
    })
  }
  return result
}

interface Anchor {
  oldIndex: number
  newIndex: number
}

function patienceAnchors(oldLines: string[], newLines: string[]): Anchor[] {
  const oldKeys = oldLines.map(lineKey)
  const newKeys = newLines.map(lineKey)
  const oldCounts = countKeys(oldKeys)
  const newCounts = countKeys(newKeys)
  const newPositions = new Map<string, number>()

  for (let i = 0; i < newKeys.length; i++) {
    const key = newKeys[i]!
    if (newCounts.get(key) === 1) newPositions.set(key, i)
  }

  const candidates: Anchor[] = []
  for (let i = 0; i < oldKeys.length; i++) {
    const key = oldKeys[i]!
    const newIndex = newPositions.get(key)
    if (oldCounts.get(key) === 1 && newIndex !== undefined) {
      candidates.push({ oldIndex: i, newIndex })
    }
  }

  return longestIncreasingSubsequence(candidates)
}

function longestIncreasingSubsequence(anchors: Anchor[]): Anchor[] {
  if (anchors.length === 0) return []

  const tails: number[] = []
  const previous = new Array<number>(anchors.length).fill(-1)

  for (let i = 0; i < anchors.length; i++) {
    const value = anchors[i]!.newIndex
    let lo = 0
    let hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (anchors[tails[mid]!]!.newIndex < value) lo = mid + 1
      else hi = mid
    }
    if (lo > 0) previous[i] = tails[lo - 1]!
    tails[lo] = i
  }

  const sequence: Anchor[] = []
  let cursor = tails[tails.length - 1]!
  while (cursor !== -1) {
    sequence.push(anchors[cursor]!)
    cursor = previous[cursor]!
  }
  sequence.reverse()
  return sequence
}

function countKeys(keys: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1)
  return counts
}

function lineKey(line: string): string {
  return `${hashLine(line)}\0${line}`
}

function hashLine(line: string): string {
  let hash = 2166136261
  for (let i = 0; i < line.length; i++) {
    hash ^= line.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function splitLines(text: string): string[] {
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

function linesToText(lines: string[]): string {
  return lines.join('\n')
}

function appendEdits(target: LineEdit[], edits: LineEdit[]): void {
  for (const edit of edits) pushEdit(target, edit)
}

function pushEdit(target: LineEdit[], edit: LineEdit): void {
  if (edit.lines.length === 0) return
  const previous = target[target.length - 1]
  if (previous && previous.type === edit.type) {
    previous.lines.push(...edit.lines)
    return
  }
  target.push(edit)
}

// ---------------------------------------------------------------------------
// Word-level diff
// ---------------------------------------------------------------------------

/**
 * Compute a word-level diff between two strings.
 */
export function diffWords(oldText: string, newText: string): WordEdit[] {
  return _diffWords(oldText, newText).map((c) => ({
    type: c.added ? 'insert' : c.removed ? 'delete' : 'equal',
    value: c.value,
  }))
}

// ---------------------------------------------------------------------------
// Re-export applyPatch for convenience
// ---------------------------------------------------------------------------

export { applyPatch }
