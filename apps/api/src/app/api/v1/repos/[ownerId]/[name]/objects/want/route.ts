/**
 * POST /api/v1/repos/:ownerId/:name/objects/want
 *
 * Want/have negotiation: given a list of hashes, return which ones the server
 * is missing.  The client should upload only those.
 *
 * Request:  { "hashes": ["abc...", ...] }
 * Response: { "missing": ["abc...", ...] }
 */

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { getCachedSession } from '../../../../../../../../lib/session-cache'
import { getMissingHashes } from '../../../../../../../../lib/objects'
import {
  requireReadAccess,
  accessErrorResponse,
  sessionUserId,
} from '../../../../../../../../lib/repo-access'

const WantSchema = z.object({
  hashes: z.array(z.string().length(64).regex(/^[0-9a-f]{64}$/)).max(10_000),
})

interface RouteParams {
  params: Promise<{ ownerId: string; name: string }>
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { ownerId, name } = await params
  const session = await getCachedSession(request.headers)

  try {
    // Read access is sufficient — anyone who can read can ask what's present
    await requireReadAccess(sessionUserId(session), ownerId, name)

    const body: unknown = await request.json()
    const parsed = WantSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const missing = await getMissingHashes(parsed.data.hashes)
    return NextResponse.json({ missing })
  } catch (err) {
    return (
      accessErrorResponse(err) ??
      NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    )
  }
}
