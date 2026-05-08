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
import { getCachedSession } from '../../../../../../../../lib/session-cache'
import { db, refs } from '@rekurn/db'
import { and, eq } from 'drizzle-orm'
import {
  requireWriteAccess,
  accessErrorResponse,
} from '../../../../../../../../lib/repo-access'
import { randomUUID } from 'node:crypto'
import { verifySignature } from '@rekurn/crypto'

const HashRegex = /^[0-9a-f]{64}$/

const UpdateRefSchema = z.object({
  commitHash: z.string().regex(HashRegex, 'commitHash must be a 64-char hex string'),
  isImmutable: z.boolean().optional(),
  /** If provided, only update if current value equals expectedHash. Use null to assert non-existence. */
  expectedHash: z
    .string()
      .regex(HashRegex)
      .nullable()
      .optional(),
  pushCertificate: z.object({
    payload: z.object({
      refName: z.string().min(1),
      oldHash: z.string().regex(HashRegex).nullable(),
      newHash: z.string().regex(HashRegex),
      pusher: z.string().email(),
      timestamp: z.number().int(),
      nonce: z.string().regex(/^[0-9a-f]{32}$/),
    }),
    signature: z.string().regex(/^[0-9a-f]{128}$/),
    publicKey: z.string().regex(/^[0-9a-f]{64}$/),
  }).optional(),
})

interface RouteParams {
  params: Promise<{ ownerId: string; name: string; refName: string[] }>
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { ownerId, name, refName } = await params
  const session = await getCachedSession(request.headers)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const fullRefName = refName.join('/')

  // Validate ref name format before any DB access
  const VALID_REF = /^(heads|tags)\/[a-zA-Z0-9][a-zA-Z0-9._\-/]{0,198}$/
  if (!VALID_REF.test(fullRefName)) {
    return NextResponse.json({ error: 'Invalid ref name' }, { status: 400 })
  }

  const body: unknown = await request.json()
  const parsed = UpdateRefSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const { commitHash, expectedHash, isImmutable, pushCertificate } = parsed.data

  try {
    const repo = await requireWriteAccess(session.user.id, ownerId, name)

    // Get current ref value
    const existing = await db
      .select()
      .from(refs)
      .where(and(eq(refs.repoId, repo.id), eq(refs.name, fullRefName)))
      .limit(1)

    const currentHash = existing[0]?.commitHash ?? null

    if (pushCertificate) {
      const certError = validatePushCertificate(
        pushCertificate,
        fullRefName,
        currentHash,
        commitHash,
        session.user.email,
      )
      if (certError) return NextResponse.json({ error: certError }, { status: 400 })
    }

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
          isImmutable: isImmutable ?? false,
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

function validatePushCertificate(
  cert: z.infer<typeof UpdateRefSchema>['pushCertificate'],
  refName: string,
  currentHash: string | null,
  commitHash: string,
  sessionEmail: string,
): string | null {
  if (!cert) return null
  const { payload } = cert

  if (payload.refName !== refName) return 'Push certificate ref does not match request ref'
  if (payload.oldHash !== currentHash) return 'Push certificate old hash does not match current ref'
  if (payload.newHash !== commitHash) return 'Push certificate new hash does not match request commit'
  if (payload.pusher !== sessionEmail) return 'Push certificate pusher does not match authenticated user'

  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - payload.timestamp) > 300) return 'Push certificate timestamp is outside the allowed window'

  const ok = verifySignature(
    Buffer.from(canonicalJson(payload), 'utf8'),
    cert.signature,
    cert.publicKey,
  )
  return ok ? null : 'Push certificate signature is invalid'
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const obj = value as Record<string, unknown>
  return `{${Object.keys(obj).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(obj[key])}`).join(',')}}`
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { ownerId, name, refName } = await params
  const session = await getCachedSession(request.headers)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const fullRefName = refName.join('/')

  // Validate ref name format before any DB access
  const VALID_REF = /^(heads|tags)\/[a-zA-Z0-9][a-zA-Z0-9._\-/]{0,198}$/
  if (!VALID_REF.test(fullRefName)) {
    return NextResponse.json({ error: 'Invalid ref name' }, { status: 400 })
  }

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
