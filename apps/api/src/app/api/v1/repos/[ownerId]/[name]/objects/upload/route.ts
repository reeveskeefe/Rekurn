/**
 * POST /api/v1/repos/:ownerId/:name/objects/upload
 *
 * Upload a single object.
 *
 * Request:  { "hash": "<sha256>", "data": "<base64-encoded bytes>" }
 * Response: { "ok": true }
 *
 * The server verifies the declared hash against the actual content before
 * storing anything.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '../../../../../../../../lib/auth'
import { storeObject, validateObjectHash } from '../../../../../../../../lib/objects'
import {
  requireWriteAccess,
  accessErrorResponse,
} from '../../../../../../../../lib/repo-access'

const MAX_OBJECT_BYTES = 100 * 1024 * 1024 // 100 MB
// Base64 expands bytes by ~4/3; add a small margin
const MAX_DATA_CHARS = Math.ceil(MAX_OBJECT_BYTES * 4 / 3) + 256

const UploadSchema = z.object({
  hash: z.string().length(64).regex(/^[0-9a-f]{64}$/),
  data: z.string().max(MAX_DATA_CHARS), // base64-encoded bytes
})

interface RouteParams {
  params: Promise<{ ownerId: string; name: string }>
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { ownerId, name } = await params
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const repo = await requireWriteAccess(session.user.id, ownerId, name)

    const body: unknown = await request.json()
    const parsed = UploadSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const { hash, data } = parsed.data

    // Decode base64 → Buffer
    const bytes = Buffer.from(data, 'base64')

    if (bytes.length > MAX_OBJECT_BYTES) {
      return NextResponse.json(
        { error: `Object too large (max ${MAX_OBJECT_BYTES / 1024 / 1024} MB)` },
        { status: 413 },
      )
    }

    // Verify content integrity
    try {
      validateObjectHash(hash, bytes)
    } catch {
      return NextResponse.json({ error: 'Hash mismatch: content does not match declared hash' }, { status: 400 })
    }

    await storeObject(repo.id, hash, bytes)

    return NextResponse.json({ ok: true })
  } catch (err) {
    return (
      accessErrorResponse(err) ??
      NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    )
  }
}
