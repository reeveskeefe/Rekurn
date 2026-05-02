import { diffLines } from './myers.js'
import type { LineEdit } from './myers.js'

// ---------------------------------------------------------------------------
// Unified diff output  (similar to `diff -u` / `git diff`)
// ---------------------------------------------------------------------------

const CONTEXT_LINES = 3
const MAX_TEXT_DIFF_BYTES = 4 * 1024 * 1024
const MIN_BYTES_PER_NEWLINE = 4_000

interface Hunk {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  lines: string[]
}

/**
 * Build a unified diff string from two texts.
 *
 * Output format:
 *   diff --rekurn a/<path> b/<path>
 *   --- a/<path>
 *   +++ b/<path>
 *   @@ -<old> +<new> @@
 *   <lines>
 */
export function unifiedDiff(
  oldText: string,
  newText: string,
  oldPath: string,
  newPath: string,
): string {
  if (oldText === newText) return ''

  const opaqueReason = opaqueDiffReason(oldText, newText)
  if (opaqueReason) return opaqueDiff(oldPath, newPath, opaqueReason)

  const edits = diffLines(oldText, newText)
  const hunks = buildHunks(edits)

  if (hunks.length === 0) return ''

  const lines: string[] = [
    `diff --rekurn a/${oldPath} b/${newPath}`,
    `--- a/${oldPath}`,
    `+++ b/${newPath}`,
  ]

  for (const hunk of hunks) {
    const oldCount = hunk.oldCount === 1 ? '' : `,${hunk.oldCount}`
    const newCount = hunk.newCount === 1 ? '' : `,${hunk.newCount}`
    lines.push(`@@ -${hunk.oldStart}${oldCount} +${hunk.newStart}${newCount} @@`)
    lines.push(...hunk.lines)
  }

  return lines.join('\n') + '\n'
}

export function opaqueFileDiff(oldPath: string, newPath: string, reason: string): string {
  return opaqueDiff(oldPath, newPath, reason)
}

function opaqueDiffReason(oldText: string, newText: string): string | null {
  if (oldText.includes('\0') || newText.includes('\0')) {
    return 'Binary files differ; text diff omitted.'
  }

  const bytes = Buffer.byteLength(oldText) + Buffer.byteLength(newText)
  if (bytes > MAX_TEXT_DIFF_BYTES) {
    return 'Large file differs; text diff omitted.'
  }

  const newlineCount = countNewlines(oldText) + countNewlines(newText)
  if (bytes > 256 * 1024 && newlineCount > 0 && bytes / newlineCount > MIN_BYTES_PER_NEWLINE) {
    return 'Low-newline-density file differs; text diff omitted.'
  }

  return null
}

function opaqueDiff(oldPath: string, newPath: string, reason: string): string {
  return [
    `diff --rekurn a/${oldPath} b/${newPath}`,
    `--- a/${oldPath}`,
    `+++ b/${newPath}`,
    '@@ opaque @@',
    reason,
    '',
  ].join('\n')
}

function countNewlines(text: string): number {
  let count = 0
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) count++
  }
  return count
}

function buildHunks(edits: LineEdit[]): Hunk[] {
  // Expand edits into a flat list of annotated lines
  interface AnnotatedLine {
    type: 'equal' | 'insert' | 'delete'
    content: string
    oldLine: number
    newLine: number
  }

  const annotated: AnnotatedLine[] = []

  for (const edit of edits) {
    for (let i = 0; i < edit.lines.length; i++) {
      annotated.push({
        type: edit.type,
        content: edit.lines[i]!,
        oldLine: edit.type !== 'insert' ? edit.oldStart + i : 0,
        newLine: edit.type !== 'delete' ? edit.newStart + i : 0,
      })
    }
  }

  // Find changed-line indices
  const changedIdx = annotated
    .map((l, i) => (l.type !== 'equal' ? i : -1))
    .filter((i) => i >= 0)

  if (changedIdx.length === 0) return []

  // Group changed lines into hunk windows with CONTEXT_LINES on each side
  const hunkRanges: Array<{ start: number; end: number }> = []
  let currentStart = Math.max(0, changedIdx[0]! - CONTEXT_LINES)
  let currentEnd = Math.min(annotated.length - 1, changedIdx[0]! + CONTEXT_LINES)

  for (let i = 1; i < changedIdx.length; i++) {
    const nextStart = Math.max(0, changedIdx[i]! - CONTEXT_LINES)
    if (nextStart <= currentEnd + 1) {
      currentEnd = Math.min(annotated.length - 1, changedIdx[i]! + CONTEXT_LINES)
    } else {
      hunkRanges.push({ start: currentStart, end: currentEnd })
      currentStart = nextStart
      currentEnd = Math.min(annotated.length - 1, changedIdx[i]! + CONTEXT_LINES)
    }
  }
  hunkRanges.push({ start: currentStart, end: currentEnd })

  // Build Hunk objects
  return hunkRanges.map(({ start, end }) => {
    const slice = annotated.slice(start, end + 1)
    const hunkLines: string[] = slice.map((l) => {
      const prefix = l.type === 'insert' ? '+' : l.type === 'delete' ? '-' : ' '
      return `${prefix}${l.content}`
    })

    const firstOld = slice.find((l) => l.type !== 'insert')
    const firstNew = slice.find((l) => l.type !== 'delete')
    const oldCount = slice.filter((l) => l.type !== 'insert').length
    const newCount = slice.filter((l) => l.type !== 'delete').length

    return {
      oldStart: firstOld?.oldLine ?? 1,
      oldCount,
      newStart: firstNew?.newLine ?? 1,
      newCount,
      lines: hunkLines,
    }
  })
}
