/**
 * GET /auth/cli-login?callback=<url>&state=<token>
 *
 * Serves a minimal HTML page that lets the user enter their email address.
 * The inline JavaScript sends the magic link request via Better Auth and then
 * shows a "check your email" message.
 *
 * Security:
 *  - `callback` is validated to be an http://localhost origin.
 *  - `state` is treated as an opaque string (validated by the CLI on receipt).
 *  - XSS: all user-supplied query params are HTML-escaped before injection.
 */
import { NextResponse, type NextRequest } from 'next/server'

function escJs(s: string) {
  // Safe to embed inside a JS string literal after JSON.stringify-style escaping.
  return JSON.stringify(s)
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const callback = searchParams.get('callback') ?? ''
  const state = searchParams.get('state') ?? ''

  // Validate callback is a localhost URL (prevents open-redirect abuse)
  let callbackUrl: URL
  try {
    callbackUrl = new URL(callback)
  } catch {
    return new NextResponse('Invalid callback URL', { status: 400 })
  }

  if (callbackUrl.hostname !== 'localhost' && callbackUrl.hostname !== '127.0.0.1') {
    return new NextResponse('callback must be a localhost URL', { status: 400 })
  }

  // The magic link callbackURL will be used as-is by Better Auth (relative path)
  const magicCallbackPath = `/auth/cli-callback?callback=${encodeURIComponent(callback)}&state=${encodeURIComponent(state)}`

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Rekurn — Log in</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0d0d10;
      color: #e2e2e7;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card {
      background: #18181f;
      border: 1px solid #2a2a35;
      border-radius: 12px;
      padding: 40px 36px;
      width: 100%;
      max-width: 400px;
    }
    .logo { font-size: 1.6rem; font-weight: 700; letter-spacing: -0.5px; margin-bottom: 8px; }
    .subtitle { color: #888; font-size: 0.9rem; margin-bottom: 32px; }
    label { display: block; font-size: 0.85rem; color: #aaa; margin-bottom: 6px; }
    input[type="email"] {
      width: 100%;
      padding: 10px 14px;
      background: #0d0d10;
      border: 1px solid #2a2a35;
      border-radius: 8px;
      color: #e2e2e7;
      font-size: 1rem;
      outline: none;
      transition: border-color 0.15s;
    }
    input[type="email"]:focus { border-color: #6c63ff; }
    button {
      margin-top: 16px;
      width: 100%;
      padding: 11px;
      background: #6c63ff;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s;
    }
    button:hover:not(:disabled) { background: #574fd6; }
    button:disabled { opacity: 0.6; cursor: not-allowed; }
    .message {
      margin-top: 20px;
      padding: 12px 14px;
      border-radius: 8px;
      font-size: 0.9rem;
      display: none;
    }
    .message.success { background: #0f2a1e; border: 1px solid #1a5c38; color: #4ade80; }
    .message.error   { background: #2a0f0f; border: 1px solid #5c1a1a; color: #f87171; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">Rekurn</div>
    <div class="subtitle">Enter your email to receive a login link</div>
    <form id="form">
      <label for="email">Email address</label>
      <input id="email" type="email" name="email" autocomplete="email"
             placeholder="you@example.com" required autofocus />
      <button type="submit" id="btn">Send login link</button>
    </form>
    <div id="msg" class="message"></div>
  </div>

  <script>
    const MAGIC_CALLBACK = ${escJs(magicCallbackPath)};

    const form = document.getElementById('form');
    const btn  = document.getElementById('btn');
    const msg  = document.getElementById('msg');

    function showMsg(text, type) {
      msg.textContent = text;
      msg.className = 'message ' + type;
      msg.style.display = 'block';
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('email').value.trim();
      if (!email) return;

      btn.disabled = true;
      btn.textContent = 'Sending…';

      try {
        const res = await fetch('/api/auth/magic-link/send-magic-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, callbackURL: MAGIC_CALLBACK }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.message || 'Failed to send magic link');
        }

        form.style.display = 'none';
        showMsg(
          'Check your email! Click the link to complete login. You can close this tab afterwards.',
          'success'
        );
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Send login link';
        showMsg(err.message || 'Something went wrong. Please try again.', 'error');
      }
    });
  </script>
</body>
</html>`

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
