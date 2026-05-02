import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '../../../../../../../lib/auth'
import { db, deployments } from '@rekurn/db'
import { desc, eq } from 'drizzle-orm'
import {
  accessErrorResponse,
  requireReadAccess,
  requireWriteAccess,
  sessionUserId,
} from '../../../../../../../lib/repo-access'

const DeploymentSchema = z.object({
  commitHash: z.string().regex(/^[0-9a-f]{64}$/),
  env: z.enum(['production', 'preview', 'staging']),
  status: z.enum(['pending', 'building', 'ready', 'error', 'cancelled']).default('ready'),
  externalDeploymentId: z.string().optional(),
  externalUrl: z.string().optional(),
  notes: z.string().optional(),
})

interface RouteParams {
  params: Promise<{ ownerId: string; name: string }>
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { ownerId, name } = await params
  const session = await auth.api.getSession({ headers: request.headers })

  try {
    const repo = await requireReadAccess(sessionUserId(session), ownerId, name)
    const rows = await db
      .select()
      .from(deployments)
      .where(eq(deployments.repoId, repo.id))
      .orderBy(desc(deployments.createdAt))
      .limit(50)
    return NextResponse.json(rows)
  } catch (err) {
    return accessErrorResponse(err) ?? NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { ownerId, name } = await params
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body: unknown = await request.json()
  const parsed = DeploymentSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  try {
    const repo = await requireWriteAccess(session.user.id, ownerId, name)
    const [inserted] = await db
      .insert(deployments)
      .values({
        repoId: repo.id,
        commitHash: parsed.data.commitHash,
        env: parsed.data.env,
        status: parsed.data.status,
        vercelDeploymentId: parsed.data.externalDeploymentId,
        vercelUrl: parsed.data.externalUrl,
        notes: parsed.data.notes,
      })
      .returning()

    return NextResponse.json(inserted, { status: 201 })
  } catch (err) {
    return accessErrorResponse(err) ?? NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
