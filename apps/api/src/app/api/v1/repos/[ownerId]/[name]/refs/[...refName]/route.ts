/**
 * PUT    /api/v1/repos/:ownerId/:name/refs/:...refName  — create or update a ref (CAS)
 * DELETE /api/v1/repos/:ownerId/:name/refs/:...refName  — delete a ref
 *
 * The refName catch-all matches names like "heads/main" or "tags/v1.0".
 *
 * PUT request body:
 *   { "commitHash": "<sha256>", "expectedHash": "<sha256>" | null }
 *
 *   If `expectedHash` is provided, the update is conditional (Compare-And-Swap):
 *   the current ref hash must equal expectedHash, otherwise 409 is returned.
 *   Pass null to create a new ref (expects the ref to not exist).
 */

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '../../../../../../../../lib/auth'
import { db, refs } from '@rekurn/db'
import { and, eq } from 'drizzle-orm'
import {
  requireWriteAccess,
  accessErrorResponse,
} from '../../../../../../../../lib/repo-access'
import { randomUUID } from 'node:crypto'

const HashRegex = /^[0-9a-f]{64}$/

const UpdateRefSchema = z.object({
  commitHash: z.string().regex(HashRegex, 'commitHash must be a 64-char hex string'),
  /** If provided, only update if current value equals expectedHash. Use null to assert non-existence. */
  expectedHash: z
    .string()
    .regex(HashRegex)
    .nullable()
    .optional(),
})

interface RouteParams {
  params: Promise<{ ownerId: string; name: string; refName: string[] }>
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { ownerId, name, refName } = await params
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const fullRefName = refName.join('/')

  const body: unknown = await request.json()
  const parsed = UpdateRefSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const { commitHash, expectedHash } = parsed.data

  try {
    const repo = await requireWriteAccess(session.user.id, ownerId, name)

    // Get current ref value
    const existing = await db
      .select()
      .from(refs)
      .where(and(eq(refs.repoId, repo.id), eq(refs.name, fullRefName)))
      .limit(1)

    const currentHash = existing[0]?.commitHash ?? null

    // CAS check
    if (expectedHash !== undefined) {
      if (expectedHash === null) {
        // Caller asserts the ref does not yet exist
        if (currentHash !== null) {
          return NextResponse.json(
            { error: 'Conflict: ref already exists', currentHash },
            { status: 409 },
          )
        }
      } else {
        // Caller asserts a specific current value
        if (currentHash !== expectedHash) {
          return NextResponse.json(
            { error: 'Conflict: ref has changed since you last fetched', currentHash },
            { status: 409 },
          )
        }
      }
    }

    // Determine ref type from name prefix
    const type = fullRefName.startsWith('tags/') ? 'tag' : 'branch'

    if (existing.length === 0) {
      // Insert new ref
      const inserted = await db
        .insert(refs)
        .values({
          id: randomUUID(),
          repoId: repo.id,
          name: fullRefName,
          commitHash,
          type,
          isImmutable: false,
        })
        .returning()

      return NextResponse.json(inserted[0], { status: 201 })
    } else {
      // Check if ref is immutable
      if (existing[0].isImmutable) {
        return NextResponse.json(
          { error: `Ref '${fullRefName}' is immutable and cannot be updated` },
          { status: 403 },
        )
      }

      // Update existing ref
      const updated = await db
        .update(refs)
        .set({ commitHash })
        .where(and(eq(refs.repoId, repo.id), eq(refs.name, fullRefName)))
        .returning()

      return NextResponse.json(updated[0])
    }
  } catch (err) {
    return (
      accessErrorResponse(err) ??
      NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    )
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { ownerId, name, refName } = await params
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const fullRefName = refName.join('/')

  try {
    const repo = await requireWriteAccess(session.user.id, ownerId, name)

    const existing = await db
      .select()
      .from(refs)
      .where(and(eq(refs.repoId, repo.id), eq(refs.name, fullRefName)))
      .limit(1)

    if (existing.length === 0) {
      return NextResponse.json({ error: 'Ref not found' }, { status: 404 })
    }

    if (existing[0].isImmutable) {
      return NextResponse.json(
        { error: `Ref '${fullRefName}' is immutable and cannot be deleted` },
        { status: 403 },
      )
    }

    await db
      .delete(refs)
      .where(and(eq(refs.repoId, repo.id), eq(refs.name, fullRefName)))

    return NextResponse.json({ ok: true })
  } catch (err) {
    return (
      accessErrorResponse(err) ??
      NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    )
  }
}
