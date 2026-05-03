/**
 * Remote URL helpers for the Rekurn CLI.
 *
 * Remote URLs have the form:  https://<host>/<owner>/<repoName>
 *
 * <owner> may be either a username slug (e.g. "keefe") or a raw Better Auth
 * UUID.  The server resolves both — the CLI stores whatever the user typed.
 *
 * Examples:
 *   https://api.rekurn.com/keefe/myproject       ← pretty username URL
 *   https://api.rekurn.com/a1b2c3d4-uuid/myproject ← UUID fallback
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { rekurnDir } from './repo.js'

export interface RemoteInfo {
  apiUrl: string   // e.g. "https://api.rekurn.com"
  ownerId: string  // Better Auth user UUID
  repoName: string
}

export interface RemoteSecurityOptions {
  allowInsecureLocalhost?: boolean
}

// ---------------------------------------------------------------------------
// URL parsing / formatting
// ---------------------------------------------------------------------------

export function parseRemoteUrl(url: string): RemoteInfo | null {
  try {
    const parsed = new URL(url)
    const parts = parsed.pathname.replace(/^\//, '').split('/').filter(Boolean)
    if (parts.length < 2) return null
    return {
      apiUrl: `${parsed.protocol}//${parsed.host}`,
      ownerId: parts[0]!,
      repoName: parts[1]!,
    }
  } catch {
    return null
  }
}

export function formatRemoteUrl(apiUrl: string, ownerId: string, repoName: string): string {
  return `${apiUrl.replace(/\/$/, '')}/${ownerId}/${repoName}`
}

export function assertSecureRemote(
  remote: RemoteInfo,
  options: RemoteSecurityOptions = {},
): void {
  const url = new URL(remote.apiUrl)
  const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1'

  if (url.username || url.password) {
    throw new Error('remote URL must not contain embedded credentials')
  }

  if (url.protocol !== 'https:') {
    if (!(options.allowInsecureLocalhost && isLocalhost && url.protocol === 'http:')) {
      throw new Error('remote URL must use HTTPS')
    }
  }

  if (!remote.ownerId || !remote.repoName) {
    throw new Error('remote URL must include owner and repository name')
  }
}

// ---------------------------------------------------------------------------
// Config read / write
// ---------------------------------------------------------------------------

export function getRemote(repoRoot: string): RemoteInfo | null {
  const configPath = join(rekurnDir(repoRoot), 'config')
  if (!existsSync(configPath)) return null
  try {
    const raw = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>
    const remote = raw.remote as { url?: string } | undefined
    if (!remote?.url) return null
    return parseRemoteUrl(remote.url)
  } catch {
    return null
  }
}

export function setRemote(repoRoot: string, apiUrl: string, ownerId: string, repoName: string): void {
  const configPath = join(rekurnDir(repoRoot), 'config')
  let existing: Record<string, unknown> = {}
  if (existsSync(configPath)) {
    try {
      existing = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>
    } catch {
      // Ignore malformed config
    }
  }
  const updated = {
    ...existing,
    remote: {
      name: 'origin',
      url: formatRemoteUrl(apiUrl, ownerId, repoName),
    },
  }
  writeFileSync(configPath, JSON.stringify(updated, null, 2), 'utf-8')
}

export function setRemoteUrl(repoRoot: string, url: string): RemoteInfo {
  const remote = parseRemoteUrl(url)
  if (!remote) throw new Error('remote URL must look like https://api.your-site.com/<username>/<repo-name>')
  assertSecureRemote(remote, {
    allowInsecureLocalhost: process.env.REKURN_ALLOW_INSECURE_REMOTE === '1',
  })
  setRemote(repoRoot, remote.apiUrl, remote.ownerId, remote.repoName)
  return remote
}
