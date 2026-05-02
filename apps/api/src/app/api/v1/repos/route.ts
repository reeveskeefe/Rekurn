/**
 * GET  /api/v1/repos    — list the authenticated user's repositories
 * POST /api/v1/repos    — create a new repository
 */

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '../../../../lib/auth'
import { db, repos } from '@rekurn/db'
import { eq, and } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

const CreateRepoSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Name may only contain letters, numbers, hyphens, and underscores'),
  description: z.string().max(500).optional(),
  visibility: z.enum(['public', 'private']).default('private'),
  defaultBranch: z.string().default('main'),
})

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userRepos = await db
    .select()
    .from(repos)
    .where(eq(repos.ownerId, session.user.id))
    .orderBy(repos.createdAt)

  return NextResponse.json(userRepos)
}

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body: unknown = await request.json()
  const parsed = CreateRepoSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const { name, description, visibility, defaultBranch } = parsed.data

  // Check for name conflict (unique per owner)
  const conflict = await db
    .select({ id: repos.id })
    .from(repos)
    .where(and(eq(repos.ownerId, session.user.id), eq(repos.name, name)))
    .limit(1)

  if (conflict.length > 0) {
    return NextResponse.json(
      { error: `Repository '${name}' already exists` },
      { status: 409 },
    )
  }

  const newRepo = await db
    .insert(repos)
    .values({
      id: randomUUID(),
      name,
      ownerId: session.user.id,
      description: description ?? null,
      visibility,
      defaultBranch,
    })
    .returning()

  return NextResponse.json(newRepo[0], { status: 201 })
}
