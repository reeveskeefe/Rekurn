/**
 * GET /auth/cli-callback?callback=<url>&state=<token>
 *
 * Better Auth redirects here after the user verifies their magic link.
 * The session cookie is already set at this point.
 *
 * This route:
 *   1. Reads the active session using the session cookie.
 *   2. Forwards the session token + state to the CLI's local HTTP server.
 *
 * Security:
 *   - `callback` must be a localhost URL.
 *   - Only the session token (opaque random string) is sent — no PII in URL.
 *   - State is validated by the CLI to prevent CSRF / session fixation.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { getCachedSession } from '../../../lib/session-cache'

const ERROR_HTML = (msg: string) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Rekurn — Login error</title>
  <style>
    body { font-family: sans-serif; background: #0d0d10; color: #f87171;
           display: flex; align-items: center; justify-content: center;
           min-height: 100vh; }
    .card { background: #18181f; border: 1px solid #5c1a1a; border-radius: 12px;
            padding: 40px 36px; max-width: 400px; text-align: center; }
    h2 { margin-bottom: 12px; }
    p { color: #aaa; font-size: 0.9rem; }
  </style>
</head>
<body>
  <div class="card">
    <h2>Login failed</h2>
    <p>${msg}</p>
    <p style="margin-top:16px;">You can close this tab and try again.</p>
  </div>
</body>
</html>`

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const callback = searchParams.get('callback') ?? ''
  const state = searchParams.get('state') ?? ''

  // Validate callback origin
  let callbackUrl: URL
  try {
    callbackUrl = new URL(callback)
  } catch {
    return new NextResponse(ERROR_HTML('Invalid callback URL.'), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }

  if (callbackUrl.hostname !== 'localhost' && callbackUrl.hostname !== '127.0.0.1') {
    return new NextResponse(ERROR_HTML('Callback must be a localhost URL.'), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }

  // Read session — magic link sets a cookie before redirecting here
  const session = await getCachedSession(request.headers)
  if (!session) {
    return new NextResponse(
      ERROR_HTML('Session not found. The magic link may have expired — please try again.'),
      { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    )
  }

  // Forward token + state to the CLI's local callback server via a self-submitting
  // POST form — keeps the session token out of the browser URL bar and history.
  function escAttr(s: string) {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Rekurn — Completing login…</title>
  <style>
    body { font-family: sans-serif; background: #0d0d10; color: #4ade80;
           display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    p { color: #aaa; font-size: 0.9rem; }
  </style>
</head>
<body>
  <p>Completing login… you can close this tab in a moment.</p>
  <form id="f" method="POST" action="${escAttr(callback)}">
    <input type="hidden" name="token" value="${escAttr(session.session.token)}" />
    <input type="hidden" name="state" value="${escAttr(state)}" />
  </form>
  <script>document.getElementById('f').submit();</script>
</body>
</html>`

  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
