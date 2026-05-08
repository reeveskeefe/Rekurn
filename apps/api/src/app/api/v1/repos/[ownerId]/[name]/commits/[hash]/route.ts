/**
 * GET /api/v1/repos/:ownerId/:name/commits/:hash
 *
 * Fetch a single commit by its SHA-256 hash.
 *
 * Response: CommitObject
 */

import { NextResponse, type NextRequest } from 'next/server'
import { getCachedSession } from '../../../../../../../../lib/session-cache'
import { db, commits } from '@rekurn/db'
import { and, eq } from 'drizzle-orm'
import {
  requireReadAccess,
  accessErrorResponse,
  sessionUserId,
} from '../../../../../../../../lib/repo-access'
import type { CommitObject, Identity } from '@rekurn/types'

interface RouteParams {
  params: Promise<{ ownerId: string; name: string; hash: string }>
}

function parseIdentity(ident: string): Identity {
  const match = /^(.*?) <([^>]+)> (\d+)$/.exec(ident)
  if (!match) return { name: ident, email: 'unknown@unknown', timestamp: 0 }
  return {
    name: match[1]!,
    email: match[2]!,
    timestamp: parseInt(match[3]!, 10),
  }
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { ownerId, name, hash } = await params
  const session = await getCachedSession(request.headers)

  if (!/^[0-9a-f]{64}$/.test(hash)) {
    return NextResponse.json({ error: 'Invalid hash format' }, { status: 400 })
  }

  try {
    const repo = await requireReadAccess(sessionUserId(session), ownerId, name)

    const rows = await db
      .select()
      .from(commits)
      .where(and(eq(commits.repoId, repo.id), eq(commits.hash, hash)))
      .limit(1)

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Commit not found' }, { status: 404 })
    }

    const row = rows[0]
    const author = parseIdentity(row.authorIdent ?? '')
    const result: CommitObject = {
      type: 'commit',
      hash: row.hash,
      treeHash: row.treeHash ?? '',
      parentHashes: (row.parentHashes as string[]) ?? [],
      author,
      committer: author,
      message: row.message ?? '',
      ...(row.signature ? { signature: row.signature } : {}),
    }

    return NextResponse.json(result)
  } catch (err) {
    return (
      accessErrorResponse(err) ??
      NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    )
  }
}
