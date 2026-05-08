/**
 * GET /api/v1/repos/:ownerId/:name/refs  — list all refs for a repository
 */

import { NextResponse, type NextRequest } from 'next/server'
import { getCachedSession } from '../../../../../../../lib/session-cache'
import { db, refs } from '@rekurn/db'
import { eq } from 'drizzle-orm'
import {
  requireReadAccess,
  accessErrorResponse,
  sessionUserId,
} from '../../../../../../../lib/repo-access'

interface RouteParams {
  params: Promise<{ ownerId: string; name: string }>
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { ownerId, name } = await params
  const session = await getCachedSession(request.headers)

  try {
    const repo = await requireReadAccess(sessionUserId(session), ownerId, name)

    const allRefs = await db
      .select({
        name: refs.name,
        commitHash: refs.commitHash,
        type: refs.type,
        isImmutable: refs.isImmutable,
        createdAt: refs.createdAt,
      })
      .from(refs)
      .where(eq(refs.repoId, repo.id))
      .orderBy(refs.name)

    return NextResponse.json({ refs: allRefs })
  } catch (err) {
    return (
      accessErrorResponse(err) ??
      NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    )
  }
}
