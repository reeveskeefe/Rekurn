/**
 * GET /api/v1/users/me        — return current user's profile (id, username, name, email)
 * PUT /api/v1/users/me        — set / update username
 *
 * Username rules:
 *   - 1–39 characters
 *   - lowercase letters, digits, hyphens only
 *   - cannot start or end with a hyphen
 *   - globally unique
 */

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { getCachedSession } from '../../../../../lib/session-cache'
import { db, users } from '@rekurn/db'
import { eq } from 'drizzle-orm'

const UsernameSchema = z
  .string()
  .min(1)
  .max(39)
  .regex(
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/,
    'Username may only contain lowercase letters, digits, and hyphens, and cannot start or end with a hyphen',
  )

export async function GET(request: NextRequest) {
  const session = await getCachedSession(request.headers)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rows = await db
    .select({ id: users.id, username: users.username, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1)

  if (rows.length === 0) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  return NextResponse.json(rows[0])
}

export async function PUT(request: NextRequest) {
  const session = await getCachedSession(request.headers)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = UsernameSchema.safeParse((body as Record<string, unknown>)?.username)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid username' }, { status: 422 })
  }

  const username = parsed.data

  // Check uniqueness (excluding self)
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .limit(1)

  if (existing.length > 0 && existing[0]!.id !== session.user.id) {
    return NextResponse.json({ error: 'Username already taken' }, { status: 409 })
  }

  await db
    .update(users)
    .set({ username, updatedAt: new Date() })
    .where(eq(users.id, session.user.id))

  return NextResponse.json({ ok: true, username })
}
