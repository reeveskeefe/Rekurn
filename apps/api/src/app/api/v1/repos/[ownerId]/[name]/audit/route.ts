import { NextResponse, type NextRequest } from 'next/server'
import { db, auditLog } from '@rekurn/db'
import { desc, eq } from 'drizzle-orm'
import { auth } from '../../../../../../../lib/auth'
import {
  accessErrorResponse,
  requireReadAccess,
  sessionUserId,
} from '../../../../../../../lib/repo-access'

interface RouteParams {
  params: Promise<{ ownerId: string; name: string }>
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { ownerId, name } = await params
  const session = await auth.api.getSession({ headers: request.headers })

  try {
    const repo = await requireReadAccess(sessionUserId(session), ownerId, name)
    const rows = await db
      .select({
        action: auditLog.action,
        meta: auditLog.meta,
        ip: auditLog.ip,
        createdAt: auditLog.createdAt,
        userId: auditLog.userId,
      })
      .from(auditLog)
      .where(eq(auditLog.repoId, repo.id))
      .orderBy(desc(auditLog.createdAt))
      .limit(100)

    return NextResponse.json(rows)
  } catch (err) {
    return accessErrorResponse(err) ?? NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
