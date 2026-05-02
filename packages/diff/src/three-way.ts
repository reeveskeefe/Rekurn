export interface MergeFileEntry {
  path: string
  hash: string
  mode: '100644' | '100755' | '120000'
  content: Buffer | (() => Buffer)
}

export interface MergeConflict {
  path: string
  base?: MergeFileEntry
  ours?: MergeFileEntry
  theirs?: MergeFileEntry
  content: Buffer
}

export interface MergeResult {
  files: Map<string, MergeFileEntry>
  conflicts: MergeConflict[]
}

export function threeWayMerge(
  base: Map<string, MergeFileEntry>,
  ours: Map<string, MergeFileEntry>,
  theirs: Map<string, MergeFileEntry>,
  labels: { ours: string; theirs: string } = { ours: 'HEAD', theirs: 'theirs' },
): MergeResult {
  const files = new Map<string, MergeFileEntry>()
  const conflicts: MergeConflict[] = []
  const paths = new Set([...base.keys(), ...ours.keys(), ...theirs.keys()])

  for (const path of [...paths].sort()) {
    const baseEntry = base.get(path)
    const oursEntry = ours.get(path)
    const theirsEntry = theirs.get(path)

    if (sameEntry(oursEntry, theirsEntry)) {
      if (oursEntry) files.set(path, oursEntry)
      continue
    }

    if (sameEntry(baseEntry, oursEntry)) {
      if (theirsEntry) files.set(path, theirsEntry)
      continue
    }

    if (sameEntry(baseEntry, theirsEntry)) {
      if (oursEntry) files.set(path, oursEntry)
      continue
    }

    const conflictContent = conflictMarkers(readContent(oursEntry), readContent(theirsEntry), labels)
    const mergedEntry: MergeFileEntry = {
      path,
      hash: '',
      mode: (oursEntry?.mode ?? theirsEntry?.mode ?? '100644') as MergeFileEntry['mode'],
      content: conflictContent,
    }
    files.set(path, mergedEntry)
    conflicts.push({
      path,
      base: baseEntry,
      ours: oursEntry,
      theirs: theirsEntry,
      content: conflictContent,
    })
  }

  return { files, conflicts }
}

function sameEntry(a: MergeFileEntry | undefined, b: MergeFileEntry | undefined): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  return a.hash === b.hash && a.mode === b.mode
}

function conflictMarkers(
  ours: Buffer,
  theirs: Buffer,
  labels: { ours: string; theirs: string },
): Buffer {
  const oursText = ensureTrailingNewline(ours.toString('utf8'))
  const theirsText = ensureTrailingNewline(theirs.toString('utf8'))
  return Buffer.from(
    `<<<<<<< ${labels.ours}\n${oursText}=======\n${theirsText}>>>>>>> ${labels.theirs}\n`,
    'utf8',
  )
}

function ensureTrailingNewline(text: string): string {
  return text.length === 0 || text.endsWith('\n') ? text : `${text}\n`
}

function readContent(entry: MergeFileEntry | undefined): Buffer {
  if (!entry) return Buffer.alloc(0)
  return typeof entry.content === 'function' ? entry.content() : entry.content
}
