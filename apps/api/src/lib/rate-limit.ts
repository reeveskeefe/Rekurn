/**
 * Rate limiter — Redis-first with Postgres fallback.
 *
 * Hot path: Vercel KV (Upstash Redis) INCR pipeline — sub-millisecond and
 * consistent across all serverless instances via Redis atomic operations.
 * KV TTL handles window expiry automatically; no cleanup queries needed.
 *
 * Fallback: if KV is unavailable the original Postgres upsert path is used,
 * so rate limiting is never disabled.
 */

import { kv } from '@vercel/kv'
import { db, rateLimits } from '@rekurn/db'
import { sql } from 'drizzle-orm'

export interface RateLimitResult {
  ok: boolean
  retryAfter: number
}

export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  try {
    return await rateLimitKv(key, limit, Math.ceil(windowMs / 1000))
  } catch {
    // KV unavailable — fall back to Postgres
    return rateLimitPostgres(key, limit, windowMs)
  }
}

async function rateLimitKv(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const redisKey = `rl:${key}`

  // Atomic pipeline: INCR the counter and set expiry only if the key has no
  // TTL yet (NX).  This ensures the window resets naturally when the key
  // expires rather than on every request.
  const pipeline = kv.pipeline()
  pipeline.incr(redisKey)
  pipeline.expire(redisKey, windowSeconds, 'NX')
  const results = await pipeline.exec() as [number, ...unknown[]]
  const count = results[0]

  if (count <= limit) return { ok: true, retryAfter: 0 }

  const ttl = await kv.ttl(redisKey)
  return { ok: false, retryAfter: Math.max(0, ttl) }
}

async function rateLimitPostgres(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const now = new Date()
  const resetAt = new Date(now.getTime() + windowMs)

  // Atomic upsert:
  //  - INSERT new row (count=1, resetAt=now+window)
  //  - On conflict: if the existing window has expired, restart it; otherwise increment
  const rows = await db
    .insert(rateLimits)
    .values({ key, count: 1, resetAt })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`CASE WHEN rate_limits.reset_at <= NOW() THEN 1 ELSE rate_limits.count + 1 END`,
        resetAt: sql`CASE WHEN rate_limits.reset_at <= NOW() THEN ${resetAt} ELSE rate_limits.reset_at END`,
      },
    })
    .returning({ count: rateLimits.count, resetAt: rateLimits.resetAt })

  const row = rows[0]
  if (!row) return { ok: true, retryAfter: 0 }

  const ok = row.count <= limit
  const retryAfter = ok ? 0 : Math.ceil((row.resetAt.getTime() - now.getTime()) / 1000)

  // Lazy cleanup: delete expired rows on ~2% of requests to keep the table lean
  if (Math.random() < 0.02) {
    db.delete(rateLimits)
      .where(sql`reset_at < NOW() - INTERVAL '5 minutes'`)
      .catch(() => { /* non-critical */ })
  }

  return { ok, retryAfter }
}

