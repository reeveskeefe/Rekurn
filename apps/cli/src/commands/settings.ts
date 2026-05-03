/**
 * rekurn settings
 *
 * Opens a local browser page where you can:
 *   - See all Rekurn sites you're connected to
 *   - Switch the active site
 *   - Remove a site
 *   - Get instructions for adding a new site (rekurn login <url>)
 *
 * The page communicates with a short-lived local HTTP server.
 */

import http from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import chalk from 'chalk'
import { loadStore, setActiveSite, removeSite } from '../lib/credentials.js'

// ---------------------------------------------------------------------------
// Settings page HTML
// ---------------------------------------------------------------------------
function settingsPage(store: ReturnType<typeof loadStore>, serverToken: string): string {
  const sites = store ? Object.entries(store.sites) : []
  const active = store?.active ?? ''

  const siteRows = sites.length === 0
    ? `<div class="empty">No sites configured yet. Run <code>rekurn login https://api.your-site.com</code> in your terminal.</div>`
    : sites.map(([url, site]) => {
        const isActive = url === active
        return `
        <div class="site-row ${isActive ? 'site-active' : ''}" data-url="${url}">
          <div class="site-info">
            <div class="site-url">${url}${isActive ? ' <span class="badge">active</span>' : ''}</div>
            <div class="site-meta">Logged in as <strong>${site.email}</strong></div>
          </div>
          <div class="site-actions">
            ${!isActive ? `<button class="btn-switch" data-url="${url}">Switch</button>` : ''}
            <button class="btn-remove" data-url="${url}">Remove</button>
          </div>
        </div>`
      }).join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Rekurn — Settings</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0d0d10; color: #e2e8f0;
      min-height: 100vh; display: flex; align-items: flex-start; justify-content: center;
      padding: 40px 24px;
    }
    .card {
      background: #13131a; border: 1px solid #2a2a3a; border-radius: 16px;
      padding: 40px 36px; max-width: 620px; width: 100%;
    }
    .header { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 32px; }
    .logo { font-size: 1.5rem; font-weight: 700; color: #4ade80; letter-spacing: -0.5px; }
    .page-title { font-size: 1rem; color: #6b7280; }
    h2 { font-size: 0.85rem; font-weight: 600; color: #6b7280; text-transform: uppercase;
         letter-spacing: 0.08em; margin-bottom: 12px; }
    .sites-list { display: flex; flex-direction: column; gap: 10px; margin-bottom: 32px; }
    .site-row {
      display: flex; align-items: center; justify-content: space-between; gap: 16px;
      background: #1a1a24; border: 1px solid #2a2a3a; border-radius: 10px; padding: 14px 16px;
      transition: border-color 0.15s;
    }
    .site-row.site-active { border-color: #4ade8055; background: #0f2a1e; }
    .site-info { flex: 1; min-width: 0; }
    .site-url { font-size: 0.9rem; color: #f1f5f9; font-weight: 500; word-break: break-all; }
    .site-meta { font-size: 0.8rem; color: #6b7280; margin-top: 3px; }
    .site-meta strong { color: #94a3b8; }
    .badge {
      display: inline-block; background: #4ade8022; border: 1px solid #4ade8055;
      color: #4ade80; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.05em;
      padding: 1px 7px; border-radius: 20px; margin-left: 8px; vertical-align: middle;
      text-transform: uppercase;
    }
    .site-actions { display: flex; gap: 8px; flex-shrink: 0; }
    button {
      border: none; border-radius: 7px; padding: 7px 14px;
      font-size: 0.82rem; font-weight: 600; cursor: pointer; transition: opacity 0.15s;
    }
    button:hover { opacity: 0.85; }
    .btn-switch { background: #4ade80; color: #0d1a10; }
    .btn-remove { background: #2a1a1a; color: #f87171; border: 1px solid #3a2020; }
    .empty { color: #4b5563; font-size: 0.9rem; padding: 20px 0; }
    code {
      background: #0d0d10; border: 1px solid #2a2a3a; border-radius: 4px;
      padding: 1px 6px; font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 0.85em; color: #86efac;
    }
    .add-section {
      background: #1a1a24; border: 1px solid #2a2a3a; border-radius: 10px; padding: 18px 16px;
    }
    .add-title { font-size: 0.9rem; font-weight: 600; color: #cbd5e1; margin-bottom: 6px; }
    .add-body { font-size: 0.85rem; color: #6b7280; line-height: 1.6; }
    .cmd {
      display: inline-block; background: #0d0d10; border: 1px solid #2a2a3a; border-radius: 6px;
      padding: 4px 12px; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.85rem;
      color: #86efac; margin-top: 8px;
    }
    .done-row { margin-top: 28px; text-align: right; }
    .btn-done { background: #2a2a3a; color: #94a3b8; padding: 9px 20px; font-size: 0.9rem; }
    #status { font-size: 0.8rem; color: #4ade80; margin-top: 10px; min-height: 1.2em; }
    #status.err { color: #f87171; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="logo">rekurn</div>
      <div class="page-title">Settings</div>
    </div>

    <h2>Connected sites</h2>
    <div class="sites-list" id="sites-list">
      ${siteRows}
    </div>

    <div class="add-section">
      <div class="add-title">Connect to another site</div>
      <div class="add-body">
        To add a new Rekurn site, run this in your terminal:
        <div class="cmd">rekurn login https://api.their-site.com</div>
      </div>
    </div>

    <div id="status"></div>

    <div class="done-row">
      <button class="btn-done" id="btn-done">Close</button>
    </div>
  </div>

  <script>
    const _serverToken = '${serverToken}'
    const status = document.getElementById('status')

    async function api(method, path, body) {
      const res = await fetch(path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Server-Token': _serverToken,
        },
        body: JSON.stringify(body ?? {}),
      })
      return res.json()
    }

    document.getElementById('sites-list').addEventListener('click', async (e) => {
      const btn = e.target.closest('button')
      if (!btn) return
      const url = btn.dataset.url
      status.className = ''

      if (btn.classList.contains('btn-switch')) {
        try {
          await api('POST', '/api/active', { apiUrl: url })
          status.textContent = 'Switched to ' + url
          setTimeout(() => location.reload(), 600)
        } catch {
          status.textContent = 'Failed to switch site — please try again.'
          status.className = 'err'
        }
      }

      if (btn.classList.contains('btn-remove')) {
        if (!confirm('Remove ' + url + '?')) return
        try {
          await api('DELETE', '/api/site', { apiUrl: url })
          status.textContent = 'Removed. To reconnect: rekurn login ' + url
          setTimeout(() => location.reload(), 1200)
        } catch {
          status.textContent = 'Failed to remove site — please try again.'
          status.className = 'err'
        }
      }
    })

    document.getElementById('btn-done').addEventListener('click', async () => {
      await fetch('/api/close', {
        headers: { 'X-Server-Token': _serverToken },
      }).catch(() => {})
      window.close()
    })
  </script>
</body>
</html>`
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------
export async function settingsCommand(): Promise<void> {
  const serverToken = randomBytes(32).toString('hex')
  const server = http.createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') {
    console.error(chalk.red('Failed to start local settings server'))
    process.exit(1)
  }
  const port = address.port
  const settingsUrl = `http://127.0.0.1:${port}?t=${serverToken}`

  console.log(chalk.cyan('Opening Rekurn settings in your browser…'))
  console.log(chalk.dim(`If it did not open: ${settingsUrl}`))

  try {
    const { default: open } = await import('open')
    await open(settingsUrl)
  } catch { /* user has the fallback URL */ }

  // ---------------------------------------------------------------------------
  // CSRF token helper — returns true if the request carries the correct token
  // ---------------------------------------------------------------------------
  function checkToken(req: http.IncomingMessage): boolean {
    const provided = req.headers['x-server-token']
    if (typeof provided !== 'string') return false
    const a = Buffer.from(provided)
    const b = Buffer.from(serverToken)
    return a.length === b.length && timingSafeEqual(a, b)
  }

  await new Promise<void>((resolve) => {
    server.on('request', (req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)

      // Serve the settings page — validate the token in the URL query param
      if (req.method === 'GET' && url.pathname === '/') {
        const t = url.searchParams.get('t') ?? ''
        const a = Buffer.from(t)
        const b = Buffer.from(serverToken)
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          res.writeHead(403, { 'Content-Type': 'text/plain' }).end('Forbidden')
          return
        }
        const store = loadStore()
        res.writeHead(200, { 'Content-Type': 'text/html' }).end(settingsPage(store, serverToken))
        return
      }

      // Switch active site
      if (req.method === 'POST' && url.pathname === '/api/active') {
        if (!checkToken(req)) { res.writeHead(403, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Forbidden' })); return }
        let body = ''
        req.on('data', (chunk: Buffer) => { body += chunk.toString() })
        req.on('end', () => {
          try {
            const { apiUrl } = JSON.parse(body) as { apiUrl?: string }
            if (!apiUrl) { res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'apiUrl required' })); return }
            const ok = setActiveSite(apiUrl)
            res.writeHead(200, { 'Content-Type': 'application/json' })
              .end(JSON.stringify({ ok }))
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Bad request' }))
          }
        })
        return
      }

      // Remove a site
      if (req.method === 'DELETE' && url.pathname === '/api/site') {
        if (!checkToken(req)) { res.writeHead(403, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Forbidden' })); return }
        let body = ''
        req.on('data', (chunk: Buffer) => { body += chunk.toString() })
        req.on('end', () => {
          try {
            const { apiUrl } = JSON.parse(body) as { apiUrl?: string }
            if (!apiUrl) { res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'apiUrl required' })); return }
            removeSite(apiUrl)
            res.writeHead(200, { 'Content-Type': 'application/json' })
              .end(JSON.stringify({ ok: true }))
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Bad request' }))
          }
        })
        return
      }

      // Close the server
      if (req.method === 'GET' && url.pathname === '/api/close') {
        if (!checkToken(req)) { res.writeHead(403, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Forbidden' })); return }
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true }))
        server.close()
        resolve()
        return
      }

      res.writeHead(404).end()
    })
  })

  console.log(chalk.dim('Settings closed.'))
}
