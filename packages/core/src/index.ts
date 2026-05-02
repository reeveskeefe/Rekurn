// Blob
export { createBlob, serializeBlob, hashBlob } from './blob.js'

// Tree
export {
  createTree,
  serializeTree,
  hashTree,
  buildTreeFromPaths,
  type FlatEntry,
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
