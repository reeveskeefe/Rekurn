/**
 * Remote URL helpers for the Rekurn CLI.
 *
 * Remote URLs have the form:  https://<api-host>/<userId>/<repoName>
 *
 * Example:  https://api.rekurn.com/a1b2c3d4-uuid/myproject
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { rekurnDir } from './repo.js'

export interface RemoteInfo {
  apiUrl: string   // e.g. "https://api.rekurn.com"
  ownerId: string  // Better Auth user UUID
  repoName: string
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
