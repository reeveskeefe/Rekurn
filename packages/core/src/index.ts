// Blob
export { createBlob, serializeBlob, hashBlob, blobHeader } from './blob.js'

// Tree
export {
  createTree,
  serializeTree,
  hashTree,
  buildTreeFromPaths,
  flattenTreeEntries,
  treeEntriesToMap,
  type FlatEntry,
  type TreeFileEntry,
  type TreeReader,
} from './tree.js'

// Commit
export {
  createCommit,
  serializeCommit,
  hashCommit,
  serializeCommitBody,
} from './commit.js'

// Parse / deserialize
export {
  detectObjectType,
  parseCommit,
  parseTree,
  parseBlob,
  computeObjectHash,
  type ParsedBlob,
} from './parse.js'
