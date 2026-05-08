/**
 * GET /api/v1/repos/:ownerId/:name/objects/:hash
 *
 * Download a single object by its SHA-256 hash.
 *
 * Response: { "hash": "...", "type": "blob"|"tree"|"commit", "size": 123, "data": "<base64>" }
 */

import { NextResponse, type NextRequest } from 'next/server'
import { getCachedSession } from '../../../../../../../../lib/session-cache'
import { getObjectBytes } from '../../../../../../../../lib/objects'
import { db, objects } from '@rekurn/db'
import { eq } from 'drizzle-orm'
import {
  requireReadAccess,
  accessErrorResponse,
  sessionUserId,
} from '../../../../../../../../lib/repo-access'

interface RouteParams {
  params: Promise<{ ownerId: string; name: string; hash: string }>
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { ownerId, name, hash } = await params
  const session = await getCachedSession(request.headers)

  // Validate hash format
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    return NextResponse.json({ error: 'Invalid hash format' }, { status: 400 })
  }

  try {
    await requireReadAccess(sessionUserId(session), ownerId, name)

    // Get object metadata
    const meta = await db
      .select({ type: objects.type, size: objects.size })
      .from(objects)
      .where(eq(objects.hash, hash))
      .limit(1)

    if (meta.length === 0) {
      return NextResponse.json({ error: 'Object not found' }, { status: 404 })
    }

    const bytes = await getObjectBytes(hash)
    if (!bytes) {
      return NextResponse.json({ error: 'Object data unavailable' }, { status: 404 })
    }

    return NextResponse.json({
      hash,
      type: meta[0].type,
      size: meta[0].size,
      data: bytes.toString('base64'),
    })
  } catch (err) {
    return (
      accessErrorResponse(err) ??
      NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    )
  }
}
