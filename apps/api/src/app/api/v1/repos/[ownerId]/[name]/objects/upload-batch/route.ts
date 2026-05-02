/**
 * POST /api/v1/repos/:ownerId/:name/objects/upload-batch
 *
 * Upload multiple objects in one authenticated request.
 *
 * Request:  { "objects": [{ "hash": "<sha256>", "data": "<base64 bytes>" }] }
 * Response: { "ok": true, "stored": 3 }
 */

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '../../../../../../../../lib/auth'
import { storeObject, validateObjectHash } from '../../../../../../../../lib/objects'
import {
  requireWriteAccess,
  accessErrorResponse,
} from '../../../../../../../../lib/repo-access'

const MAX_OBJECT_BYTES = 100 * 1024 * 1024
const MAX_BATCH_REQUEST_BYTES = 25 * 1024 * 1024

const UploadBatchSchema = z.object({
  objects: z.array(z.object({
    hash: z.string().length(64).regex(/^[0-9a-f]{64}$/),
    data: z.string(),
  })).min(1).max(2_000),
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

    const contentLength = Number(request.headers.get('content-length') ?? '0')
    if (contentLength > MAX_BATCH_REQUEST_BYTES) {
      return NextResponse.json(
        { error: `Batch request too large (max ${MAX_BATCH_REQUEST_BYTES / 1024 / 1024} MB)` },
        { status: 413 },
      )
    }

    const body: unknown = await request.json()
    const parsed = UploadBatchSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const decoded: Array<{ hash: string; bytes: Buffer }> = []
    let estimatedRequestBytes = 16

    for (const object of parsed.data.objects) {
      const bytes = Buffer.from(object.data, 'base64')
      if (bytes.length > MAX_OBJECT_BYTES) {
        return NextResponse.json(
          { error: `Object too large (max ${MAX_OBJECT_BYTES / 1024 / 1024} MB)` },
          { status: 413 },
        )
      }

      estimatedRequestBytes += object.data.length + object.hash.length + 90
      if (estimatedRequestBytes > MAX_BATCH_REQUEST_BYTES) {
        return NextResponse.json(
          { error: `Batch request too large (max ${MAX_BATCH_REQUEST_BYTES / 1024 / 1024} MB)` },
          { status: 413 },
        )
      }

      try {
        validateObjectHash(object.hash, bytes)
      } catch {
        return NextResponse.json(
          { error: 'Hash mismatch: content does not match declared hash' },
          { status: 400 },
        )
      }

      decoded.push({ hash: object.hash, bytes })
    }

    for (const object of decoded) {
      await storeObject(repo.id, object.hash, object.bytes)
    }

    return NextResponse.json({ ok: true, stored: decoded.length })
  } catch (err) {
    return (
      accessErrorResponse(err) ??
      NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    )
  }
}
