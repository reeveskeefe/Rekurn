import { sha256 } from '@rekurn/crypto'
import type { TreeEntry, TreeObject, FileMode } from '@rekurn/types'

/**
 * Produce the canonical JSON string for tree hashing.
 * Entries are sorted by name so the tree hash is deterministic regardless
 * of insertion order.
 */
function canonicalTreeBody(entries: TreeEntry[]): string {
  const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name))
  return JSON.stringify({ type: 'tree', entries: sorted })
}

/**
 * Create a Tree object from an array of entries.
 *
 * The hash format is:
 *   SHA-256("rekurn-tree\n<canonical-json>")
 */
export function createTree(entries: TreeEntry[]): TreeObject {
  const body = canonicalTreeBody(entries)
  const hash = sha256(`rekurn-tree\n${body}`)
  const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name))
  return { type: 'tree', hash, entries: sorted }
}

/**
 * Produce the canonical byte representation of a tree for storage or transport.
 */
export function serializeTree(tree: TreeObject): Buffer {
  return Buffer.from(`rekurn-tree\n${canonicalTreeBody(tree.entries)}`)
}

/**
 * Compute the hash for a set of entries without constructing the full object.
 */
export function hashTree(entries: TreeEntry[]): string {
  return createTree(entries).hash
}

// ---------------------------------------------------------------------------
// Nested tree construction from a flat path list
// ---------------------------------------------------------------------------

export interface FlatEntry {
  /** Relative path from repo root, e.g. "src/lib/repo.ts" */
  path: string
  hash: string
  mode: FileMode
}

interface SubTreeResult {
  trees: TreeObject[]
  entries: TreeEntry[]
}

/**
 * Recursively build tree objects from a flat list of file paths.
 *
 * Example input:
 *   [
 *     { path: 'package.json', hash: 'a1b2...', mode: '100644' },
 *     { path: 'src/index.ts', hash: 'c3d4...', mode: '100644' },
 *     { path: 'src/lib/repo.ts', hash: 'e5f6...', mode: '100644' },
 *   ]
 *
 * Produces three Tree objects:
 *   - lib/ (contains repo.ts)
 *   - src/ (contains index.ts + lib/ tree)
 *   - root (contains package.json + src/ tree)
 *
 * @returns rootTree — the top-level tree, and allTrees — every tree created
 *   (including nested ones), suitable for writing to the object store.
 */
export function buildTreeFromPaths(flatEntries: FlatEntry[]): {
  rootTree: TreeObject
  allTrees: TreeObject[]
} {
  const { trees, entries } = buildSubTree(flatEntries, '')
  const rootTree = createTree(entries)
  return { rootTree, allTrees: [...trees, rootTree] }
}

function buildSubTree(entries: FlatEntry[], prefix: string): SubTreeResult {
  const allTrees: TreeObject[] = []
  const rootEntries: TreeEntry[] = []

  // Group entries by their first path component under this prefix.
  // Files land directly in rootEntries; directories are collected for recursion.
  const dirGroups = new Map<string, FlatEntry[]>()

  for (const entry of entries) {
    // Strip the prefix + separator to get the relative path at this level.
    const relative = prefix ? entry.path.slice(prefix.length + 1) : entry.path
    const slashIdx = relative.indexOf('/')

    if (slashIdx === -1) {
      // This entry lives directly at the current tree level.
      rootEntries.push({ mode: entry.mode, name: relative, hash: entry.hash })
    } else {
      // This entry is inside a subdirectory.
      const dirName = relative.slice(0, slashIdx)
      if (!dirGroups.has(dirName)) dirGroups.set(dirName, [])
      dirGroups.get(dirName)!.push(entry)
    }
  }

  // Recursively build a tree for each subdirectory.
  for (const [dirName, subEntries] of dirGroups) {
    const subPrefix = prefix ? `${prefix}/${dirName}` : dirName
    const sub = buildSubTree(subEntries, subPrefix)
    const subTree = createTree(sub.entries)
    allTrees.push(...sub.trees, subTree)
    rootEntries.push({ mode: '040000', name: dirName, hash: subTree.hash })
  }

  return { trees: allTrees, entries: rootEntries }
}
