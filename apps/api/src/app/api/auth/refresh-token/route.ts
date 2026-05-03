/**
 * POST /api/auth/refresh-token
 *
 * Validates the caller's session (via Authorization: Bearer <session-token>)
 * and returns the session token to confirm it is still active.
 *
 * On success: { token: string }
 * On failure: 401 { error: string }
 *
 * The CLI uses this endpoint to silently re-authenticate when a stored token
 * receives a 401 from another API route. Rate limiting is enforced by
 * middleware.ts (60 req/min per IP, 300 req/min per user).
 */
import { NextResponse, type NextRequest } from 'next/server'
import { auth } from '../../../../lib/auth'

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) {
    return NextResponse.json(
      { error: 'Session expired or invalid. Please run rekurn login again.' },
      { status: 401 },
    )
  }
  return NextResponse.json({ token: session.session.token })
}
