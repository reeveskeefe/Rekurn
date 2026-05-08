import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { getCachedSession } from '../../../../../../../lib/session-cache'
import { db, repos } from '@rekurn/db'
import { eq } from 'drizzle-orm'
import {
  accessErrorResponse,
  requireReadAccess,
  requireWriteAccess,
  sessionUserId,
} from '../../../../../../../lib/repo-access'

const DeployHooksSchema = z.object({
  deployHooks: z.record(z.string(), z.string().url()),
})

interface RouteParams {
  params: Promise<{ ownerId: string; name: string }>
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { ownerId, name } = await params
  const session = await getCachedSession(request.headers)

  try {
    const repo = await requireReadAccess(sessionUserId(session), ownerId, name)
    return NextResponse.json({ deployHooks: repo.deployHooks ?? {} })
  } catch (err) {
    return accessErrorResponse(err) ?? NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { ownerId, name } = await params
  const session = await getCachedSession(request.headers)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body: unknown = await request.json()
  const parsed = DeployHooksSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  try {
    const repo = await requireWriteAccess(session.user.id, ownerId, name)
    const [updated] = await db
      .update(repos)
      .set({ deployHooks: parsed.data.deployHooks })
      .where(eq(repos.id, repo.id))
      .returning()

    return NextResponse.json({ deployHooks: updated?.deployHooks ?? parsed.data.deployHooks })
  } catch (err) {
    return accessErrorResponse(err) ?? NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
