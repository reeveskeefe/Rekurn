/**
 * POST /api/v1/auth/passkey/register
 *
 * Two-step flow — distinguished by the `action` field in the request body:
 *
 *   { "action": "challenge" }
 *     → Returns WebAuthn PublicKeyCredentialCreationOptions.
 *       Requires a valid session (passkey is tied to logged-in user).
 *
 *   { "action": "verify", "response": <RegistrationResponseJSON> }
 *     → Verifies the credential and saves it to the passkeys table.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { auth } from '../../../../../../lib/auth'
import { generateRegChallenge, verifyRegChallenge } from '../../../../../../lib/webauthn'
import type { RegistrationResponseJSON } from '@simplewebauthn/server'

export async function POST(request: NextRequest) {
  // Registration always requires an active session
  const sessionResult = await auth.api.getSession({ headers: request.headers })
  if (!sessionResult) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body: unknown = await request.json()
  if (!body || typeof body !== 'object' || !('action' in body)) {
    return NextResponse.json({ error: 'Missing action field' }, { status: 400 })
  }

  const { action } = body as { action: string; response?: RegistrationResponseJSON }

  if (action === 'challenge') {
    try {
      const options = await generateRegChallenge(
        sessionResult.user.id,
        sessionResult.user.email,
      )
      return NextResponse.json(options)
    } catch (err) {
      console.error('[passkey/register] challenge error:', err)
      return NextResponse.json({ error: 'Failed to generate challenge' }, { status: 500 })
    }
  }

  if (action === 'verify') {
    const { response } = body as { action: string; response: RegistrationResponseJSON }
    if (!response) {
      return NextResponse.json({ error: 'Missing response field' }, { status: 400 })
    }

    try {
      const result = await verifyRegChallenge(sessionResult.user.id, response)
      return NextResponse.json({ ok: true, credentialId: result.credentialId })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Verification failed'
      return NextResponse.json({ error: message }, { status: 400 })
    }
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
}
