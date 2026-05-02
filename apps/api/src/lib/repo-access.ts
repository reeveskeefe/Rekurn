/**
 * Repository access helpers — authorization checks used by all repo route handlers.
 *
 * All functions throw a plain `{ status, message }` object on failure.
 * Route handlers catch these and convert them to JSON responses.
 */

import { db, repos, users } from '@rekurn/db'
import { eq, and } from 'drizzle-orm'

export interface RepoRecord {
  id: string
  name: string
  ownerId: string
  description: string | null
  visibility: 'public' | 'private'
  defaultBranch: string
  deployHooks: Record<string, string>
  createdAt: Date
}

export interface AccessError {
  status: number
  message: string
}

/** Utility: throw a structured access error */
function fail(status: number, message: string): never {
  throw { status, message } as AccessError
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Resolve a URL segment that may be either a raw UUID or a username slug.
 * Always returns the underlying user UUID, or throws 404.
 */
export async function resolveOwnerId(ownerIdOrUsername: string): Promise<string> {
  if (UUID_RE.test(ownerIdOrUsername)) return ownerIdOrUsername
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, ownerIdOrUsername.toLowerCase()))
    .limit(1)
  if (rows.length === 0) fail(404, `User '${ownerIdOrUsername}' not found`)
  return rows[0]!.id
}

/** Look up a repo by ownerId + name. Returns null if not found. */
export async function getRepo(ownerId: string, name: string): Promise<RepoRecord | null> {
  const rows = await db
    .select()
    .from(repos)
    .where(and(eq(repos.ownerId, ownerId), eq(repos.name, name)))
    .limit(1)

  if (rows.length === 0) return null
  return rows[0] as RepoRecord
}

/**
 * Require read access.  `ownerIdOrSlug` may be a UUID or a username.
 * - Public repos: any caller (even unauthenticated).
 * - Private repos: only the owner.
 */
export async function requireReadAccess(
  userId: string | null,
  ownerIdOrSlug: string,
  name: string,
): Promise<RepoRecord> {
  const ownerId = await resolveOwnerId(ownerIdOrSlug)
  const repo = await getRepo(ownerId, name)
  if (!repo) fail(404, 'Repository not found')
  if (repo.visibility === 'private' && repo.ownerId !== userId) {
    fail(userId ? 403 : 401, 'Repository is private')
  }
  return repo
}

/**
 * Require write access.  `ownerIdOrSlug` may be a UUID or a username.
 * Only the repo owner may write.
 */
export async function requireWriteAccess(
  userId: string,
  ownerIdOrSlug: string,
  name: string,
): Promise<RepoRecord> {
  const ownerId = await resolveOwnerId(ownerIdOrSlug)
  const repo = await getRepo(ownerId, name)
  if (!repo) fail(404, 'Repository not found')
  if (repo.ownerId !== userId) fail(403, 'Permission denied')
  return repo
}

/**
 * Convert a caught access error (or any error) to a Response.
 * Returns null if the error is not an AccessError (caller should rethrow).
 */
export function accessErrorResponse(err: unknown): Response | null {
  if (
    err &&
    typeof err === 'object' &&
    'status' in err &&
    'message' in err &&
    typeof (err as AccessError).status === 'number'
  ) {
    const { status, message } = err as AccessError
    return Response.json({ error: message }, { status })
  }
  return null
}

/** Get the user ID from a Better Auth session, or null if not authenticated. */
export function sessionUserId(
  session: { user: { id: string } } | null,
): string | null {
  return session?.user.id ?? null
}
