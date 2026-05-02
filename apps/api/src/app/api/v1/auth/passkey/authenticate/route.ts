/**
 * POST /api/v1/auth/passkey/authenticate
 *
 * Two-step flow — distinguished by the `action` field in the request body:
 *
 *   { "action": "challenge", "email": "<user email>" }
 *     → Returns WebAuthn PublicKeyCredentialRequestOptions.
 *       Public route — no session required.
 *
 *   { "action": "verify", "email": "<user email>", "response": <AuthenticationResponseJSON> }
 *     → Verifies the assertion and returns a JWT the caller can use as a
 *       Bearer token. Uses the `jose` library (same EdDSA key as BA's jwt
 *       plugin won't be accessible here, so we issue a short-lived HS256 JWT
 *       signed with BETTER_AUTH_SECRET).
 */
import { NextResponse, type NextRequest } from 'next/server'
import { SignJWT } from 'jose'
import { generateAuthChallenge, verifyAuthChallenge } from '../../../../../../lib/webauthn'
import { db, users } from '@rekurn/db'
import { eq } from 'drizzle-orm'
import type { AuthenticationResponseJSON } from '@simplewebauthn/server'

function getJwtSecret() {
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) throw new Error('BETTER_AUTH_SECRET env var is not set')
  return new TextEncoder().encode(secret)
}

export async function POST(request: NextRequest) {
  const body: unknown = await request.json()
  if (!body || typeof body !== 'object' || !('action' in body)) {
    return NextResponse.json({ error: 'Missing action field' }, { status: 400 })
  }

  const { action } = body as { action: string; email?: string; response?: AuthenticationResponseJSON }

  // ── Challenge step ─────────────────────────────────────────────────────────
  if (action === 'challenge') {
    const { email } = body as { action: string; email: string }
    if (!email) return NextResponse.json({ error: 'Missing email' }, { status: 400 })

    try {
      const options = await generateAuthChallenge(email)
      return NextResponse.json(options)
    } catch (err) {
      console.error('[passkey/authenticate] challenge error:', err)
      return NextResponse.json({ error: 'Failed to generate challenge' }, { status: 500 })
    }
  }

  // ── Verify step ────────────────────────────────────────────────────────────
  if (action === 'verify') {
    const { email, response } = body as {
      action: string
      email: string
      response: AuthenticationResponseJSON
    }
    if (!email || !response) {
      return NextResponse.json({ error: 'Missing email or response' }, { status: 400 })
    }

    try {
      const { userId } = await verifyAuthChallenge(email, response)

      // Fetch user record to embed in JWT claims
      const userRows = await db
        .select({ id: users.id, email: users.email, name: users.name })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)

      if (userRows.length === 0) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 })
      }

      const user = userRows[0]
      const token = await new SignJWT({ sub: user.id, email: user.email, name: user.name })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('15m')
        .sign(getJwtSecret())

      return NextResponse.json({ token })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Authentication failed'
      return NextResponse.json({ error: message }, { status: 400 })
    }
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
}
