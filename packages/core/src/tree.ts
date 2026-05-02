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
// Tree walking helpers
// ---------------------------------------------------------------------------

export interface TreeFileEntry {
  path: string
  hash: string
  mode: FileMode
}

export type TreeReader = (treeHash: string) => TreeObject | null

/**
 * Flatten a nested tree into path-addressed file entries.
 */
export function flattenTreeEntries(
  tree: TreeObject,
  readTree: TreeReader,
  prefix = '',
): TreeFileEntry[] {
  const files: TreeFileEntry[] = []
  const stack: Array<{ tree: TreeObject; prefix: string }> = [{ tree, prefix }]

  while (stack.length > 0) {
    const current = stack.pop()!
    for (let i = current.tree.entries.length - 1; i >= 0; i--) {
      const entry = current.tree.entries[i]!
      const path = current.prefix ? `${current.prefix}/${entry.name}` : entry.name
      if (entry.mode === '040000') {
        const child = readTree(entry.hash)
        if (child) stack.push({ tree: child, prefix: path })
      } else {
        files.push({ path, hash: entry.hash, mode: entry.mode })
      }
    }
  }

  return files.sort((a, b) => a.path.localeCompare(b.path))
}

export function treeEntriesToMap(entries: TreeFileEntry[]): Record<string, TreeFileEntry> {
  const map: Record<string, TreeFileEntry> = {}
  for (const entry of entries) map[entry.path] = entry
  return map
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
  const root = createTrieNode()
  for (const entry of flatEntries) {
    insertTrieEntry(root, entry)
  }

  const trees: TreeObject[] = []
  const entries = buildTrieTree(root, trees)
  const rootTree = createTree(entries)
  return { rootTree, allTrees: [...trees, rootTree] }
}

interface TrieNode {
  file: { hash: string; mode: FileMode } | null
  children: Map<string, TrieNode>
}

function createTrieNode(): TrieNode {
  return { file: null, children: new Map() }
}

function insertTrieEntry(root: TrieNode, entry: FlatEntry): void {
  const parts = entry.path.split('/').filter(Boolean)
  if (parts.length === 0) return

  let node = root
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!
    if (i === parts.length - 1) {
      let leaf = node.children.get(part)
      if (!leaf) {
        leaf = createTrieNode()
        node.children.set(part, leaf)
      }
      leaf.file = { hash: entry.hash, mode: entry.mode }
      return
    }

    let child = node.children.get(part)
    if (!child) {
      child = createTrieNode()
      node.children.set(part, child)
    }
    node = child
  }
}

function buildTrieTree(node: TrieNode, allTrees: TreeObject[]): TreeEntry[] {
  const entries: TreeEntry[] = []
  const names = [...node.children.keys()].sort((a, b) => a.localeCompare(b))

  for (const name of names) {
    const child = node.children.get(name)!
    if (child.children.size > 0) {
      const childEntries = buildTrieTree(child, allTrees)
      const childTree = createTree(childEntries)
      allTrees.push(childTree)
      entries.push({ mode: '040000', name, hash: childTree.hash })
    } else if (child.file) {
      entries.push({ mode: child.file.mode, name, hash: child.file.hash })
    }
  }

  return entries
}
