import { z } from 'zod'

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** 64-character lowercase hex string (SHA-256 output). */
export const HashSchema = z
  .string()
  .length(64)
  .regex(/^[0-9a-f]{64}$/, 'Invalid SHA-256 hash')

export type Hash = z.infer<typeof HashSchema>

export const FileModeSchema = z.enum(['100644', '100755', '040000', '120000'])
export type FileMode = z.infer<typeof FileModeSchema>

// ---------------------------------------------------------------------------
// Object model — Blob
// ---------------------------------------------------------------------------

export const BlobObjectSchema = z.object({
  type: z.literal('blob'),
  hash: HashSchema,
  size: z.number().int().nonnegative(),
})

export type BlobObject = z.infer<typeof BlobObjectSchema>

// ---------------------------------------------------------------------------
// Object model — Tree
// ---------------------------------------------------------------------------

export const TreeEntrySchema = z.object({
  mode: FileModeSchema,
  name: z.string().min(1),
  hash: HashSchema,
})

export type TreeEntry = z.infer<typeof TreeEntrySchema>

export const TreeObjectSchema = z.object({
  type: z.literal('tree'),
  hash: HashSchema,
  entries: z.array(TreeEntrySchema),
})

export type TreeObject = z.infer<typeof TreeObjectSchema>

// ---------------------------------------------------------------------------
// Object model — Commit
// ---------------------------------------------------------------------------

export const IdentitySchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  /** Unix timestamp in seconds. */
  timestamp: z.number().int(),
})

export type Identity = z.infer<typeof IdentitySchema>

export const CommitDataSchema = z.object({
  treeHash: HashSchema,
  parentHashes: z.array(HashSchema),
  author: IdentitySchema,
  committer: IdentitySchema,
  message: z.string().min(1),
  /** Hex-encoded Ed25519 signature of the commit body (optional). */
  signature: z.string().optional(),
})

export type CommitData = z.infer<typeof CommitDataSchema>

export const CommitObjectSchema = CommitDataSchema.extend({
  type: z.literal('commit'),
  hash: HashSchema,
})

export type CommitObject = z.infer<typeof CommitObjectSchema>

// ---------------------------------------------------------------------------
// Refs
// ---------------------------------------------------------------------------

export const RefTypeSchema = z.enum(['branch', 'tag'])
export type RefType = z.infer<typeof RefTypeSchema>

export const RefSchema = z.object({
  name: z.string().min(1),
  commitHash: HashSchema,
  type: RefTypeSchema,
  isImmutable: z.boolean().default(false),
})

export type Ref = z.infer<typeof RefSchema>

// ---------------------------------------------------------------------------
// Local staging index  (.rekurn/index)
// ---------------------------------------------------------------------------

export const IndexEntrySchema = z.object({
  hash: HashSchema,
  mode: z.enum(['100644', '100755']),
  size: z.number().int().nonnegative(),
})

export type IndexEntry = z.infer<typeof IndexEntrySchema>

export const ConflictIndexEntrySchema = z.object({
  conflict: z.literal(true),
  mode: z.enum(['100644', '100755']).optional(),
  baseHash: HashSchema.optional(),
  oursHash: HashSchema.optional(),
  theirsHash: HashSchema.optional(),
})

export type ConflictIndexEntry = z.infer<typeof ConflictIndexEntrySchema>

/** Maps relative file path → IndexEntry */
export const IndexSchema = z.record(z.string(), z.union([IndexEntrySchema, ConflictIndexEntrySchema]))
export type Index = z.infer<typeof IndexSchema>

// ---------------------------------------------------------------------------
// Local HEAD  (.rekurn/HEAD)
// ---------------------------------------------------------------------------

export const SymbolicHeadSchema = z.object({
  type: z.literal('symbolic'),
  /** e.g. "refs/heads/main" */
  ref: z.string(),
})

export const DetachedHeadSchema = z.object({
  type: z.literal('detached'),
  hash: HashSchema,
})

export const HeadSchema = z.discriminatedUnion('type', [SymbolicHeadSchema, DetachedHeadSchema])
export type Head = z.infer<typeof HeadSchema>

// ---------------------------------------------------------------------------
// Local repo config  (.rekurn/config  and  ~/.rekurn/config)
// ---------------------------------------------------------------------------

export const RepoConfigSchema = z.object({
  remote: z
    .object({
      name: z.string().default('origin'),
      url: z.string().url(),
    })
    .optional(),
  user: z
    .object({
      name: z.string().optional(),
      email: z.string().email().optional(),
    })
    .optional(),
  /** Path to Ed25519 secret key file for commit signing. */
  signingKey: z.string().optional(),
  core: z
    .object({
      defaultBranch: z.string().default('main'),
    })
    .optional(),
})

export type RepoConfig = z.infer<typeof RepoConfigSchema>

// ---------------------------------------------------------------------------
// API  — common response envelope
// ---------------------------------------------------------------------------

export const ApiErrorSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
})

export type ApiError = z.infer<typeof ApiErrorSchema>

export function apiOk<T>(data: T): { ok: true; data: T } {
  return { ok: true, data }
}

export function apiError(error: string, code?: string): { ok: false; error: string; code?: string } {
  return { ok: false, error, code }
}

// ---------------------------------------------------------------------------
// Deployment
// ---------------------------------------------------------------------------

export const DeployEnvSchema = z.enum(['production', 'preview', 'staging'])
export type DeployEnv = z.infer<typeof DeployEnvSchema>

export const DeployStatusSchema = z.enum(['pending', 'building', 'ready', 'error', 'cancelled'])
export type DeployStatus = z.infer<typeof DeployStatusSchema>
