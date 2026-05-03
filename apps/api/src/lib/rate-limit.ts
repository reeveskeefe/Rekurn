/**
 * Postgres-backed rate limiter — consistent across all serverless instances.
 *
 * Uses an atomic upsert so concurrent requests from different cold-start
 * instances all share the same counters.  A lazy cleanup pass deletes
 * expired rows on ~2% of calls to avoid a dedicated cron job.
 */

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
  if (!row) {
    // Should never happen — treat as allowed
    return { ok: true, retryAfter: 0 }
  }

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
