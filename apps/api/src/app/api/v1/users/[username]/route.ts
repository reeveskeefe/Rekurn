/**
 * GET /api/v1/users/:username
 *
 * Public endpoint — resolves a username to its public profile (id, username, name).
 * Accepts either a username slug or a raw UUID.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { db, users } from '@rekurn/db'
import { eq } from 'drizzle-orm'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface RouteParams {
  params: Promise<{ username: string }>
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { username } = await params

  const rows = UUID_RE.test(username)
    ? await db
        .select({ id: users.id, username: users.username, name: users.name })
        .from(users)
        .where(eq(users.id, username))
        .limit(1)
    : await db
        .select({ id: users.id, username: users.username, name: users.name })
        .from(users)
        .where(eq(users.username, username.toLowerCase()))
        .limit(1)

  if (rows.length === 0) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  return NextResponse.json(rows[0])
}
