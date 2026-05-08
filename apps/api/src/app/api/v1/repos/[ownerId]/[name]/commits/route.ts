/**
 * GET /api/v1/repos/:ownerId/:name/commits
 *
 * List recent commits for a repository.
 *
 * Query params:
 *   n   — max commits to return (default 20, max 100)
 *
 * Response: { "commits": [CommitObject, ...] }
 *
 * Note (Phase 4): commits are returned by authoredAt DESC rather than
 * strict branch ancestry.  This is a known limitation.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { getCachedSession } from '../../../../../../../lib/session-cache'
import { db, commits } from '@rekurn/db'
import { eq, desc } from 'drizzle-orm'
import {
  requireReadAccess,
  accessErrorResponse,
  sessionUserId,
} from '../../../../../../../lib/repo-access'
import type { CommitObject, Identity } from '@rekurn/types'

interface RouteParams {
  params: Promise<{ ownerId: string; name: string }>
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
  const { ownerId, name } = await params
  const session = await getCachedSession(request.headers)

  const url = new URL(request.url)
  const nParam = url.searchParams.get('n')
  const n = Math.min(100, Math.max(1, nParam ? parseInt(nParam, 10) : 20))

  try {
    const repo = await requireReadAccess(sessionUserId(session), ownerId, name)

    const rows = await db
      .select()
      .from(commits)
      .where(eq(commits.repoId, repo.id))
      .orderBy(desc(commits.authoredAt))
      .limit(n)

    const result: CommitObject[] = rows.map((row) => {
      const author = parseIdentity(row.authorIdent ?? '')
      return {
        type: 'commit' as const,
        hash: row.hash,
        treeHash: row.treeHash ?? '',
        parentHashes: (row.parentHashes as string[]) ?? [],
        author,
        committer: author, // Phase 4 limitation: committerIdent not stored separately
        message: row.message ?? '',
        ...(row.signature ? { signature: row.signature } : {}),
      }
    })

    return NextResponse.json({ commits: result })
  } catch (err) {
    return (
      accessErrorResponse(err) ??
      NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    )
  }
}
