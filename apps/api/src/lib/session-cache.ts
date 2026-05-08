/**
 * Session cache — wraps auth.api.getSession() with a short-lived KV cache.
 *
 * The edge middleware and each serverless route handler both call getSession().
 * With a 30-second KV TTL, the first call (typically the middleware) warms the
 * cache; subsequent calls within that window skip the Postgres round-trip entirely.
 *
 * Cache key: `session:<bearer-token>` — only bearer-token requests are cached.
 * Cookie-based browser sessions (no Authorization header) always hit auth directly.
 *
 * Fallback: if KV is unavailable every call falls through to auth.api.getSession()
 * so session validation is never impacted by KV downtime.
 *
 * Note on date serialization: date fields in the session object (e.g. expiresAt)
 * are stored as ISO strings in KV.  Route handlers only read session.user.id and
 * session.session.token (both strings), so this is safe in practice.
 */

import { kv } from '@vercel/kv'
import { auth } from './auth.js'

export type CachedSession = Awaited<ReturnType<typeof auth.api.getSession>>

/** Seconds a valid session is cached in KV before a fresh DB lookup is forced. */
const SESSION_CACHE_TTL = 30

/**
 * Return the session for the current request, using a short-lived KV cache.
 * Behaviour is identical to auth.api.getSession() from the caller's perspective.
 */
export async function getCachedSession(headers: Headers): Promise<CachedSession> {
  const authHeader = headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    // Cookie-based or unauthenticated request — bypass cache
    return auth.api.getSession({ headers })
  }

  const token = authHeader.slice(7)
  const cacheKey = `session:${token}`

  // Attempt KV read
  try {
    const cached = await kv.get<CachedSession>(cacheKey)
    if (cached !== null) return cached
  } catch {
    // KV unavailable — fall through to live lookup
  }

  const session = await auth.api.getSession({ headers })

  // Only cache valid sessions; null results (invalid/expired tokens) stay a miss
  if (session !== null) {
    try {
      await kv.set(cacheKey, session, { ex: SESSION_CACHE_TTL })
    } catch {
      // Non-critical — continue without caching
    }
  }

  return session
}
