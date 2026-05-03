/**
 * rekurn login [url]
 *
 * Two-mode flow:
 *
 * FIRST-TIME (no URL configured anywhere):
 *   Opens a local setup wizard in the browser that explains how Rekurn works
 *   and lets the user enter their API URL. Once submitted the normal auth
 *   flow begins immediately — no second command needed.
 *
 * RETURNING (URL known via arg, env var, or saved credentials):
 *   Goes straight to the API host's /auth/cli-login page.
 *
 * Auth flow (both modes):
 *   1. Generate a random `state` token (CSRF protection).
 *   2. Start a temporary HTTP server on a random available port.
 *   3. Open the browser to /auth/cli-login?callback=...&state=...
 *   4. User enters email → receives magic link → clicks it.
 *   5. API redirects browser to http://127.0.0.1:<PORT>/callback?token=...&state=...
 *   6. CLI validates state, saves credentials, prints success.
 */
import http from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import chalk from 'chalk'
import { saveCredentials, loadCredentials } from '../lib/credentials.js'

// ---------------------------------------------------------------------------
// URL validation — blocks SSRF to private/internal networks
// ---------------------------------------------------------------------------
function validateApiUrl(raw: string): string {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('Invalid URL — please enter a full URL like https://api.your-site.com')
  }

  const hostname = parsed.hostname.toLowerCase()
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1'

  if (parsed.protocol !== 'https:') {
    if (!(isLocalhost && parsed.protocol === 'http:')) {
      throw new Error('URL must use HTTPS (e.g. https://api.your-site.com)')
    }
  }

  if (!isLocalhost) {
    const privatePatterns = [
      /^10\./,
      /^172\.(1[6-9]|2\d|3[01])\./,
      /^192\.168\./,
      /^169\.254\./,
      /^0\./,
      /^\[?::1\]?$/,
      /^\[?fc[0-9a-f]{2}:/i,
      /^\[?fd[0-9a-f]{2}:/i,
      /^0\.0\.0\.0$/,
    ]
    for (const re of privatePatterns) {
      if (re.test(hostname)) {
        throw new Error('Cannot connect to a private or reserved IP address')
      }
    }
  }

  return parsed.origin
}

const LOGIN_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes (setup wizard needs more time)

// ---------------------------------------------------------------------------
// Setup wizard HTML — shown when no API URL is configured
// ---------------------------------------------------------------------------
function setupPage(port: number, serverToken: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Rekurn — First-time setup</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0d0d10; color: #e2e8f0;
      min-height: 100vh; display: flex; align-items: center; justify-content: center;
      padding: 24px;
    }
    .card {
      background: #13131a; border: 1px solid #2a2a3a; border-radius: 16px;
      padding: 48px 40px; max-width: 560px; width: 100%;
    }
    .logo { font-size: 1.75rem; font-weight: 700; color: #4ade80; letter-spacing: -0.5px; margin-bottom: 8px; }
    .tagline { color: #6b7280; font-size: 0.95rem; margin-bottom: 36px; }
    h2 { font-size: 1.1rem; font-weight: 600; color: #a78bfa; margin-bottom: 16px; }
    .steps { list-style: none; margin-bottom: 36px; display: flex; flex-direction: column; gap: 12px; }
    .steps li {
      display: flex; gap: 14px; align-items: flex-start;
      background: #1a1a24; border: 1px solid #2a2a3a; border-radius: 10px; padding: 14px 16px;
    }
    .step-num {
      flex-shrink: 0; width: 26px; height: 26px; border-radius: 50%;
      background: #4ade8022; border: 1px solid #4ade8055;
      color: #4ade80; font-size: 0.8rem; font-weight: 700;
      display: flex; align-items: center; justify-content: center;
    }
    .step-body { font-size: 0.9rem; color: #cbd5e1; line-height: 1.5; }
    .step-body strong { color: #f1f5f9; }
    code {
      background: #0d0d10; border: 1px solid #2a2a3a; border-radius: 4px;
      padding: 1px 6px; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.85em;
      color: #86efac;
    }
    .divider { border: none; border-top: 1px solid #2a2a3a; margin: 32px 0; }
    label { display: block; font-size: 0.85rem; color: #94a3b8; margin-bottom: 8px; font-weight: 500; }
    .input-row { display: flex; gap: 10px; }
    input[type="url"] {
      flex: 1; background: #1a1a24; border: 1px solid #2a2a3a; border-radius: 8px;
      color: #f1f5f9; padding: 10px 14px; font-size: 0.95rem; outline: none;
      transition: border-color 0.15s;
    }
    input[type="url"]:focus { border-color: #4ade80; }
    button {
      background: #4ade80; color: #0d1a10; font-weight: 700; border: none;
      border-radius: 8px; padding: 10px 20px; font-size: 0.95rem; cursor: pointer;
      transition: background 0.15s; white-space: nowrap;
    }
    button:hover { background: #86efac; }
    .hint { margin-top: 10px; font-size: 0.8rem; color: #4b5563; }
    #error { color: #f87171; font-size: 0.85rem; margin-top: 10px; display: none; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">rekurn</div>
    <div class="tagline">Return to any version instantly — self-hosted version control.</div>

    <h2>Connect to a Rekurn site</h2>
    <ol class="steps">
      <li>
        <div class="step-num">1</div>
        <div class="step-body">
          <strong>Rekurn is self-hosted.</strong> Each site running Rekurn has its own API URL.
          You log in there with your account on that site — not with any central rekurn.com account.
        </div>
      </li>
      <li>
        <div class="step-num">2</div>
        <div class="step-body">
          <strong>Each site you connect to is independent.</strong> Your repos live on that site's
          server. You can connect to as many Rekurn sites as you like and switch between them
          using <code>rekurn settings</code>.
        </div>
      </li>
      <li>
        <div class="step-num">3</div>
        <div class="step-body">
          <strong>Want to host your own?</strong> Deploy the open-source
          <code>apps/api</code> Next.js app (Vercel, Railway, or any Node host), then enter
          your URL below. Everyone on your team logs in through the same URL.
        </div>
      </li>
      <li>
        <div class="step-num">4</div>
        <div class="step-body">
          <strong>Already have a site URL?</strong> Just paste it below and click Continue.
          Your browser will open that site's login page automatically.
        </div>
      </li>
    </ol>

    <hr class="divider" />

    <form id="setup-form">
      <label for="api-url">Rekurn site URL</label>
      <div class="input-row">
        <input
          type="url"
          id="api-url"
          name="apiUrl"
          placeholder="https://api.your-site.com"
          required
          autocomplete="off"
          spellcheck="false"
        />
        <button type="submit">Connect →</button>
      </div>
      <div class="hint">The URL of any site running the Rekurn API. You can add more sites later with <code>rekurn settings</code>.</div>
      <div id="error"></div>
    </form>
  </div>

  <script>
    const _serverToken = '${serverToken}'

    document.getElementById('setup-form').addEventListener('submit', async function(e) {
      e.preventDefault()
      const url = document.getElementById('api-url').value.trim().replace(/\\/$/, '')
      const errEl = document.getElementById('error')
      errEl.style.display = 'none'
      try { new URL(url) } catch {
        errEl.textContent = 'Please enter a full URL starting with https://'
        errEl.style.display = 'block'
        return
      }
      try {
        const res = await fetch('http://127.0.0.1:${port}/configure', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiUrl: url, _st: _serverToken })
        })
        const data = await res.json()
        if (data.loginUrl) {
          window.location.href = data.loginUrl
        } else {
          errEl.textContent = data.error ?? 'Could not connect. Check that the URL is correct and the site is reachable.'
          errEl.style.display = 'block'
        }
      } catch {
        errEl.textContent = 'Could not reach the local CLI server. Is the terminal still open?'
        errEl.style.display = 'block'
      }
    })
  </script>
</body>
</html>`
}

// ---------------------------------------------------------------------------
// Shared HTML pages
// ---------------------------------------------------------------------------
const SUCCESS_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Rekurn — Login successful</title>
  <style>
    body { font-family: sans-serif; background: #0d0d10; color: #4ade80;
           display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #0f2a1e; border: 1px solid #1a5c38; border-radius: 12px;
            padding: 40px 36px; max-width: 360px; text-align: center; }
    h2 { margin-bottom: 12px; }
    p { color: #aaa; font-size: 0.9rem; }
  </style>
</head>
<body>
  <div class="card">
    <h2>Login successful!</h2>
    <p>You can close this tab and return to your terminal.</p>
  </div>
</body>
</html>`

// ---------------------------------------------------------------------------
// Main command
// ---------------------------------------------------------------------------
export async function loginCommand(urlArg?: string): Promise<void> {
  // Resolve the API URL: explicit arg > env var > previously saved credentials
  const knownUrl = (
    urlArg ??
    process.env.REKURN_API_URL ??
    loadCredentials()?.apiUrl
  )

  const state = randomBytes(32).toString('hex')
  const serverToken = randomBytes(32).toString('hex')

  // Start local server on a random available port
  const server = http.createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') {
    console.error(chalk.red('Failed to start local server'))
    process.exit(1)
  }
  const port = address.port
  const callbackBase = `http://127.0.0.1:${port}/callback`

  // ---------------------------------------------------------------------------
  // If no URL known → show setup wizard, wait for /configure POST
  // ---------------------------------------------------------------------------
  let apiUrl: string

  if (!knownUrl) {
    const setupUrl = `http://127.0.0.1:${port}/setup`
    console.log(chalk.cyan('\nWelcome to Rekurn!'))
    console.log(chalk.dim('Opening setup wizard in your browser…'))
    console.log(chalk.dim(`If it did not open: ${setupUrl}\n`))

    try {
      const { default: open } = await import('open')
      await open(setupUrl)
    } catch { /* user has the fallback URL */ }

    // Wait for the user to submit the setup form
    apiUrl = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        server.close()
        reject(new Error('Setup timed out after 10 minutes'))
      }, LOGIN_TIMEOUT_MS)

      server.on('request', (req, res) => {
        const reqUrl = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)

        if (req.method === 'GET' && reqUrl.pathname === '/setup') {
          res.writeHead(200, { 'Content-Type': 'text/html' }).end(setupPage(port, serverToken))
          return
        }

        if (req.method === 'POST' && reqUrl.pathname === '/configure') {
          let body = ''
          req.on('data', (chunk: Buffer) => { body += chunk.toString() })
          req.on('end', () => {
            try {
              const { apiUrl: submitted, _st } = JSON.parse(body) as { apiUrl?: string; _st?: string }

              // CSRF check
              const providedToken = Buffer.from(typeof _st === 'string' ? _st : '')
              const expectedToken = Buffer.from(serverToken)
              const tokenLengthOk = providedToken.length === expectedToken.length
              if (!tokenLengthOk || !timingSafeEqual(providedToken, expectedToken)) {
                res.writeHead(403, { 'Content-Type': 'application/json' })
                  .end(JSON.stringify({ error: 'Forbidden' }))
                return
              }

              if (!submitted) {
                res.writeHead(422, { 'Content-Type': 'application/json' })
                  .end(JSON.stringify({ error: 'URL is required' }))
                return
              }

              let cleanUrl: string
              try {
                cleanUrl = validateApiUrl(submitted.replace(/\/$/, ''))
              } catch (e) {
                res.writeHead(422, { 'Content-Type': 'application/json' })
                  .end(JSON.stringify({ error: e instanceof Error ? e.message : 'Invalid URL' }))
                return
              }

              const loginUrl = `${cleanUrl}/auth/cli-login?callback=${encodeURIComponent(callbackBase)}&state=${encodeURIComponent(state)}`
              res.writeHead(200, { 'Content-Type': 'application/json' })
                .end(JSON.stringify({ loginUrl }))

              // Remove setup listener; re-register callback listener below
              server.removeAllListeners('request')
              clearTimeout(timer)
              resolve(cleanUrl)
            } catch {
              res.writeHead(400, { 'Content-Type': 'application/json' })
                .end(JSON.stringify({ error: 'Bad request' }))
            }
          })
          return
        }

        res.writeHead(404).end()
      })
    })

    console.log(chalk.dim(`API URL configured: ${apiUrl}`))
    console.log(chalk.cyan('Redirecting to login page…'))
  } else {
    apiUrl = knownUrl.replace(/\/$/, '')
    const loginUrl = `${apiUrl}/auth/cli-login?callback=${encodeURIComponent(callbackBase)}&state=${encodeURIComponent(state)}`
    console.log(chalk.cyan('Opening browser for login…'))
    console.log(chalk.dim(`If your browser did not open, visit:\n  ${loginUrl}`))
    try {
      const { default: open } = await import('open')
      await open(loginUrl)
    } catch { /* user has the fallback URL */ }
  }

  // ---------------------------------------------------------------------------
  // Wait for the auth callback
  // ---------------------------------------------------------------------------

  // For the returning-user path (no setup wizard), the browser is already open.
  // For the first-time path, the wizard form navigated the browser to loginUrl.

  const token = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      server.close()
      reject(new Error('Login timed out after 10 minutes'))
    }, LOGIN_TIMEOUT_MS)

    server.on('request', (req, res) => {
      try {
        const reqUrl = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
        if (reqUrl.pathname !== '/callback') {
          res.writeHead(404).end()
          return
        }

        // The API sends a self-submitting POST form (token never appears in URL)
        if (req.method !== 'POST') {
          res.writeHead(405, { 'Content-Type': 'text/html' })
            .end('<p>Method not allowed.</p>')
          return
        }

        let body = ''
        req.on('data', (chunk: Buffer) => { body += chunk.toString() })
        req.on('end', () => {
          try {
            // Parse application/x-www-form-urlencoded
            const params = new URLSearchParams(body)
            const receivedState = params.get('state') ?? ''
            const receivedToken = params.get('token') ?? ''

            // Timing-safe state comparison
            const stateOk =
              receivedState.length === state.length &&
              timingSafeEqual(Buffer.from(receivedState), Buffer.from(state))

            if (!stateOk) {
              res.writeHead(400, { 'Content-Type': 'text/html' })
                .end('<p>Invalid state. Please try again.</p>')
              return
            }

            if (!receivedToken) {
              res.writeHead(400, { 'Content-Type': 'text/html' })
                .end('<p>No token received. Please try again.</p>')
              return
            }

            res.writeHead(200, { 'Content-Type': 'text/html' }).end(SUCCESS_PAGE)
            clearTimeout(timer)
            server.close()
            resolve(receivedToken)
          } catch (err) {
            clearTimeout(timer)
            server.close()
            reject(err)
          }
        })
      } catch (err) {
        clearTimeout(timer)
        server.close()
        reject(err)
      }
    })
  })

  // We need the user's email and ID — fetch them from the API using the token
  let email = 'unknown'
  let userId = ''
  try {
    const res = await fetch(`${apiUrl}/api/auth/get-session`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) {
      const data: unknown = await res.json()
      if (data && typeof data === 'object' && 'user' in data) {
        const user = (data as { user: { email?: string; id?: string } }).user
        if (user.email) email = user.email
        if (user.id) userId = user.id
      }
    }
  } catch {
    // Non-fatal — we still save the token
  }

  saveCredentials({
    token,
    email,
    userId,
    apiUrl,
    savedAt: new Date().toISOString(),
  })

  console.log(chalk.green(`\nLogged in as ${email}`))
  console.log(chalk.dim('Credentials saved to ~/.rekurn/credentials.json'))
}
