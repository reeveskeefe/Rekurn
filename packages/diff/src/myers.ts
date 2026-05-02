import { diffLines as _diffLines, diffWords as _diffWords, applyPatch } from 'diff'

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
  const changes = _diffLines(oldText, newText, { newlineIsToken: false })
  const result: LineEdit[] = []
  let oldLine = 1
  let newLine = 1

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
