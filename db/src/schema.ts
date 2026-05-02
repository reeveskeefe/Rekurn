import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  uuid,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  /** Better Auth required: display name shown in emails / UI. */
  name: text('name').notNull().default(''),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  /**
   * Human-readable handle used in repo URLs: <host>/<username>/<repo>.
   * Unique, lowercase letters/numbers/hyphens only. Optional — UUID is
   * always accepted as a fallback.
   */
  username: text('username').unique(),
  /** Optional profile image URL. */
  image: text('image'),
  /** Hex-encoded Ed25519 public key for commit signing (optional). */
  publicKey: text('public_key'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  passkeys: many(passkeys),
  repos: many(repos),
}))

// ---------------------------------------------------------------------------
// Sessions (Better Auth)
// ---------------------------------------------------------------------------
export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
})

// ---------------------------------------------------------------------------
// Accounts (Better Auth – magic link / email-password fallback)
// ---------------------------------------------------------------------------
export const accounts = pgTable('accounts', {
  id: text('id').primaryKey(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  idToken: text('id_token'),
  /** Hashed password (only for email+password provider). */
  password: text('password'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Verifications (Better Auth – magic link tokens, OTPs)
// ---------------------------------------------------------------------------
export const verifications = pgTable('verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Passkeys (WebAuthn / Better Auth)
// ---------------------------------------------------------------------------
export const passkeys = pgTable('passkeys', {
  id: text('id').primaryKey(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  credentialId: text('credential_id').notNull().unique(),
  publicKey: text('public_key').notNull(),
  counter: integer('counter').notNull().default(0),
  deviceType: text('device_type'),
  backedUp: boolean('backed_up').notNull().default(false),
  transports: text('transports'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Repos
// ---------------------------------------------------------------------------
export const repos = pgTable(
  'repos',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    ownerId: uuid('owner_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    description: text('description'),
    visibility: text('visibility', { enum: ['public', 'private'] })
      .notNull()
      .default('private'),
    defaultBranch: text('default_branch').notNull().default('main'),
    deployHooks: jsonb('deploy_hooks').$type<Record<string, string>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('repos_owner_name_idx').on(t.ownerId, t.name)],
)

export const reposRelations = relations(repos, ({ one, many }) => ({
  owner: one(users, { fields: [repos.ownerId], references: [users.id] }),
  objects: many(objects),
  commits: many(commits),
  refs: many(refs),
  deployments: many(deployments),
  auditLogs: many(auditLog),
}))

// ---------------------------------------------------------------------------
// Objects  (blobs, trees — content-addressable store metadata)
// ---------------------------------------------------------------------------
export const objects = pgTable(
  'objects',
  {
    /** SHA-256 hex hash — content-addressable primary key. */
    hash: text('hash').primaryKey(),
    type: text('type', { enum: ['blob', 'tree', 'commit'] }).notNull(),
    size: integer('size').notNull(),
    repoId: uuid('repo_id')
      .references(() => repos.id, { onDelete: 'cascade' })
      .notNull(),
    /** Vercel Blob URL — only set for type='blob'. */
    blobUrl: text('blob_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('objects_repo_idx').on(t.repoId)],
)

// ---------------------------------------------------------------------------
// Commits
// ---------------------------------------------------------------------------
export const commits = pgTable(
  'commits',
  {
    hash: text('hash').primaryKey(),
    repoId: uuid('repo_id')
      .references(() => repos.id, { onDelete: 'cascade' })
      .notNull(),
    treeHash: text('tree_hash').notNull(),
    /** Array of parent commit hashes (0 = root, 1 = normal, 2+ = merge). */
    parentHashes: jsonb('parent_hashes').$type<string[]>().notNull().default([]),
    authorId: uuid('author_id').references(() => users.id),
    /** Author identity string: "Name <email> timestamp" */
    authorIdent: text('author_ident').notNull(),
    authoredAt: timestamp('authored_at', { withTimezone: true }).notNull(),
    committedAt: timestamp('committed_at', { withTimezone: true }).defaultNow().notNull(),
    message: text('message').notNull(),
    /** Hex-encoded Ed25519 signature of the commit body (optional). */
    signature: text('signature'),
  },
  (t) => [index('commits_repo_idx').on(t.repoId)],
)

export const commitsRelations = relations(commits, ({ one }) => ({
  repo: one(repos, { fields: [commits.repoId], references: [repos.id] }),
  author: one(users, { fields: [commits.authorId], references: [users.id] }),
}))

// ---------------------------------------------------------------------------
// Refs  (branches and tags)
// ---------------------------------------------------------------------------
export const refs = pgTable(
  'refs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    repoId: uuid('repo_id')
      .references(() => repos.id, { onDelete: 'cascade' })
      .notNull(),
    name: text('name').notNull(),
    commitHash: text('commit_hash').notNull(),
    type: text('type', { enum: ['branch', 'tag'] }).notNull(),
    /**
     * Immutable refs cannot be deleted or moved.
     * Set by `rekurn snapshot` — the ref acts as a permanent bookmark.
     */
    isImmutable: boolean('is_immutable').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('refs_repo_name_idx').on(t.repoId, t.name),
    index('refs_repo_idx').on(t.repoId),
  ],
)

// ---------------------------------------------------------------------------
// Deployments
// ---------------------------------------------------------------------------
export const deployments = pgTable(
  'deployments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    repoId: uuid('repo_id')
      .references(() => repos.id, { onDelete: 'cascade' })
      .notNull(),
    commitHash: text('commit_hash').notNull(),
    vercelUrl: text('vercel_url'),
    vercelDeploymentId: text('vercel_deployment_id'),
    notes: text('notes'),
    env: text('env', { enum: ['production', 'preview', 'staging'] })
      .notNull()
      .default('preview'),
    status: text('status', {
      enum: ['pending', 'building', 'ready', 'error', 'cancelled'],
    })
      .notNull()
      .default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('deployments_repo_idx').on(t.repoId)],
)

// ---------------------------------------------------------------------------
// Environment Variables  (per-branch, AES-256-GCM encrypted at rest)
// ---------------------------------------------------------------------------
export const envVars = pgTable(
  'env_vars',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    repoId: uuid('repo_id')
      .references(() => repos.id, { onDelete: 'cascade' })
      .notNull(),
    branch: text('branch').notNull(),
    key: text('key').notNull(),
    /** AES-256-GCM encrypted value: base64(iv + authTag + ciphertext) */
    encryptedValue: text('encrypted_value').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('env_vars_repo_branch_key_idx').on(t.repoId, t.branch, t.key)],
)

// ---------------------------------------------------------------------------
// Audit Log
// ---------------------------------------------------------------------------
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id),
    repoId: uuid('repo_id').references(() => repos.id),
    action: text('action').notNull(),
    meta: jsonb('meta'),
    ip: text('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('audit_log_repo_idx').on(t.repoId), index('audit_log_user_idx').on(t.userId)],
)
