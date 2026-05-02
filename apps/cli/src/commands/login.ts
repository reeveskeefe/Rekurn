/**
 * rekurn login
 *
 * Opens a browser window to the Rekurn login page, starts a local HTTP server
 * to receive the OAuth-style callback, and saves the session token to disk.
 *
 * Flow:
 *   1. Generate a random `state` token (CSRF protection).
 *   2. Start a temporary HTTP server on a random available port.
 *   3. Open the browser to /auth/cli-login?callback=...&state=...
 *   4. User enters email → receives magic link → clicks it.
 *   5. API redirects browser to http://localhost:<PORT>/callback?token=...&state=...
 *   6. CLI validates state, saves credentials, prints success.
 */
import http from 'node:http'
import { randomBytes } from 'node:crypto'
import chalk from 'chalk'
import { saveCredentials } from '../lib/credentials.js'

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

function apiUrl(): string {
  return (process.env.REKURN_API_URL ?? 'https://api.rekurn.com').replace(/\/$/, '')
}

export async function loginCommand(): Promise<void> {
  const state = randomBytes(32).toString('hex')

  // Start local callback server on a random available port (bind port 0)
  const server = http.createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') {
    console.error(chalk.red('Failed to start local server'))
    process.exit(1)
  }
  const port = address.port

  const callbackBase = `http://127.0.0.1:${port}/callback`
  const loginUrl = `${apiUrl()}/auth/cli-login?callback=${encodeURIComponent(callbackBase)}&state=${encodeURIComponent(state)}`

  // Open the browser — use the `open` package dynamically to avoid ESM issues
  console.log(chalk.cyan('Opening browser for login…'))
  console.log(chalk.dim(`If your browser did not open, visit:\n  ${loginUrl}`))

  try {
    const { default: open } = await import('open')
    await open(loginUrl)
  } catch {
    // open failed — user has the fallback URL printed above
  }

  // Wait for callback
  const token = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      server.close()
      reject(new Error('Login timed out after 5 minutes'))
    }, LOGIN_TIMEOUT_MS)

    server.on('request', (req, res) => {
      try {
        const reqUrl = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
        if (reqUrl.pathname !== '/callback') {
          res.writeHead(404).end()
          return
        }

        const receivedState = reqUrl.searchParams.get('state') ?? ''
        const receivedToken = reqUrl.searchParams.get('token') ?? ''

        if (receivedState !== state) {
          res.writeHead(400, { 'Content-Type': 'text/html' }).end(
            '<p>Invalid state parameter. Please try logging in again.</p>',
          )
          return
        }

        if (!receivedToken) {
          res.writeHead(400, { 'Content-Type': 'text/html' }).end(
            '<p>No token received. Please try logging in again.</p>',
          )
          return
        }

        // Send a success page before closing
        res.writeHead(200, { 'Content-Type': 'text/html' }).end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Rekurn — Login successful</title>
  <style>
    body { font-family: sans-serif; background: #0d0d10; color: #4ade80;
           display: flex; align-items: center; justify-content: center;
           min-height: 100vh; }
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
</html>`)

        clearTimeout(timer)
        server.close()
        resolve(receivedToken)
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
    const res = await fetch(`${apiUrl()}/api/auth/get-session`, {
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
    apiUrl: apiUrl(),
    savedAt: new Date().toISOString(),
  })

  console.log(chalk.green(`\nLogged in as ${email}`))
  console.log(chalk.dim('Credentials saved to ~/.rekurn/credentials.json'))
}
