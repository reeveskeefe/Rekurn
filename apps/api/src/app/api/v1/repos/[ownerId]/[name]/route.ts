/**
 * GET    /api/v1/repos/:ownerId/:name   — get repo info
 * DELETE /api/v1/repos/:ownerId/:name   — delete repo (owner only)
 */

import { NextResponse, type NextRequest } from 'next/server'
import { auth } from '../../../../../../lib/auth'
import { db, repos } from '@rekurn/db'
import { eq } from 'drizzle-orm'
import {
  requireReadAccess,
  requireWriteAccess,
  accessErrorResponse,
  sessionUserId,
} from '../../../../../../lib/repo-access'

interface RouteParams {
  params: Promise<{ ownerId: string; name: string }>
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { ownerId, name } = await params
  const session = await auth.api.getSession({ headers: request.headers })

  try {
    const repo = await requireReadAccess(sessionUserId(session), ownerId, name)
    return NextResponse.json(repo)
  } catch (err) {
    return accessErrorResponse(err) ?? NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { ownerId, name } = await params
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const repo = await requireWriteAccess(session.user.id, ownerId, name)
    await db.delete(repos).where(eq(repos.id, repo.id))
    return NextResponse.json({ ok: true })
  } catch (err) {
    return accessErrorResponse(err) ?? NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
