import { NextResponse, type NextRequest } from 'next/server'
import { auth } from './lib/auth'

/**
 * Middleware runs on every /api/* request.
 *
 * Public routes (no auth required):
 *   GET /api/v1          — version info
 *   /api/auth/*          — Better Auth endpoints (magic link, sign-in, etc.)
 *   /api/v1/auth/passkey/authenticate  — WebAuthn auth challenge + verify
 *
 * All other /api/* routes require a valid session via:
 *   - Session cookie (browser)
 *   - Authorization: Bearer <session-token> header (CLI / SDK via bearer plugin)
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // ── Public routes ──────────────────────────────────────────────────────────
  const isPublic =
    pathname === '/api/v1' ||
    pathname === '/api/v1/' ||
    // Better Auth handles its own auth internally
    pathname.startsWith('/api/auth/') ||
    // WebAuthn authentication (unauthenticated users need this to log in)
    pathname.startsWith('/api/v1/auth/passkey/authenticate')

  if (isPublic) {
    return NextResponse.next()
  }

  // ── Authenticated routes ───────────────────────────────────────────────────
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.next()
}

export const config = {
  matcher: '/api/:path*',
}

