/**
 * POST /api/v1/repos/:ownerId/:name/objects/batch
 *
 * Download multiple objects in one authenticated request.
 *
 * Request:  { "hashes": ["abc...", ...] }
 * Response: { "objects": [{ "hash": "...", "data": "<base64>" }], "missing": [] }
 */

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { getCachedSession } from '../../../../../../../../lib/session-cache'
import { getObjectBytes } from '../../../../../../../../lib/objects'
import {
  requireReadAccess,
  accessErrorResponse,
  sessionUserId,
} from '../../../../../../../../lib/repo-access'

const FETCH_CONCURRENCY = 8
const MAX_BATCH_RESPONSE_BYTES = 500 * 1024 * 1024 // 500 MB cap per batch response

const BatchFetchSchema = z.object({
  hashes: z.array(z.string().length(64).regex(/^[0-9a-f]{64}$/)).min(1).max(500),
})

interface RouteParams {
  params: Promise<{ ownerId: string; name: string }>
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { ownerId, name } = await params
  const session = await getCachedSession(request.headers)

  try {
    await requireReadAccess(sessionUserId(session), ownerId, name)

    const body: unknown = await request.json()
    const parsed = BatchFetchSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const rows = await mapLimit(parsed.data.hashes, FETCH_CONCURRENCY, async (hash) => ({
      hash,
      bytes: await getObjectBytes(hash),
    }))

    const objects: Array<{ hash: string; data: string }> = []
    const missing: string[] = []
    let totalResponseBytes = 0
    for (const row of rows) {
      if (row.bytes) {
        totalResponseBytes += row.bytes.length
        if (totalResponseBytes > MAX_BATCH_RESPONSE_BYTES) {
          return NextResponse.json(
            { error: 'Batch response too large — request fewer objects at a time' },
            { status: 413 },
          )
        }
        objects.push({ hash: row.hash, data: row.bytes.toString('base64') })
      } else {
        missing.push(row.hash)
      }
    }

    return NextResponse.json({ objects, missing })
  } catch (err) {
    return (
      accessErrorResponse(err) ??
      NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    )
  }
}

async function mapLimit<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0

  async function run(): Promise<void> {
    while (next < items.length) {
      const index = next++
      results[index] = await worker(items[index]!)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()))
  return results
}
