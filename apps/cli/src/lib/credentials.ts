import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { getPassword, setPassword, deletePassword } from './keychain.js'

const KEYCHAIN_SERVICE = 'rekurn'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Credentials for a single Rekurn site. */
export interface SiteCredentials {
  /** Not stored in credentials.json — kept in OS keychain. */
  token: string
  email: string
  userId: string
  savedAt: string
}

/** Shape stored on disk — token field omitted (keychain holds it). */
interface StoredSiteCredentials {
  token?: string // present only in old pre-keychain files (migrated on first read)
  email: string
  userId: string
  savedAt: string
}

/** Full multi-site store written to disk. */
export interface CredentialsStore {
  /** apiUrl of the currently active site. */
  active: string
  sites: Record<string, StoredSiteCredentials>
}

/** Convenience type: active site's credentials + its URL. */
export interface Credentials extends SiteCredentials {
  apiUrl: string
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const credentialsDir = join(homedir(), '.rekurn')
const credentialsPath = join(credentialsDir, 'credentials.json')

// ---------------------------------------------------------------------------
// Store I/O
// ---------------------------------------------------------------------------

/** Load the raw multi-site store, migrating the old single-site format if needed. */
export function loadStore(): CredentialsStore | null {
  try {
    if (!existsSync(credentialsPath)) return null
    const raw = readFileSync(credentialsPath, 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null

    // New format: has `active` + `sites`
    if ('active' in parsed && 'sites' in parsed) {
      return parsed as CredentialsStore
    }

    // Old format: flat credentials object — migrate transparently
    if ('token' in parsed && 'apiUrl' in parsed) {
      const old = parsed as Credentials
      const store: CredentialsStore = {
        active: old.apiUrl,
        sites: {
          [old.apiUrl]: {
            // token kept inline so loadCredentials can migrate it to keychain on next read
            token: old.token,
            email: old.email,
            userId: old.userId,
            savedAt: old.savedAt,
          },
        },
      }
      writeStore(store)
      return store
    }
  } catch {
    // Malformed — treat as not configured
  }
  return null
}

function writeStore(store: CredentialsStore): void {
  mkdirSync(credentialsDir, { recursive: true })
  writeFileSync(credentialsPath, JSON.stringify(store, null, 2), { mode: 0o600 })
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Load the active site's credentials, or null if not configured. */
export function loadCredentials(): Credentials | null {
  const store = loadStore()
  if (!store) return null
  const site = store.sites[store.active]
  if (!site) return null

  // Try keychain first
  let token = getPassword(KEYCHAIN_SERVICE, store.active)

  // Backward compat: old credentials.json had the token inline — migrate it
  if (!token && site.token) {
    token = site.token
    setPassword(KEYCHAIN_SERVICE, store.active, token)
    // Re-save without the inline token
    const { token: _dropped, ...rest } = site
    void _dropped
    store.sites[store.active] = rest
    writeStore(store)
  }

  if (!token) return null
  return { token, email: site.email, userId: site.userId, savedAt: site.savedAt, apiUrl: store.active }
}

/** Save (or update) credentials for a site and set it as active. */
export function saveCredentials(creds: Credentials): void {
  // Token goes to the OS keychain — never written to disk
  setPassword(KEYCHAIN_SERVICE, creds.apiUrl, creds.token)

  const store = loadStore() ?? { active: creds.apiUrl, sites: {} }
  store.sites[creds.apiUrl] = {
    email: creds.email,
    userId: creds.userId,
    savedAt: creds.savedAt,
    // token intentionally omitted
  }
  store.active = creds.apiUrl
  writeStore(store)
}

/** Switch the active site. Returns false if the site isn't configured. */
export function setActiveSite(apiUrl: string): boolean {
  const store = loadStore()
  if (!store || !store.sites[apiUrl]) return false
  store.active = apiUrl
  writeStore(store)
  return true
}

/** Remove a site from the store. If it was active, clears active. */
export function removeSite(apiUrl: string): void {
  deletePassword(KEYCHAIN_SERVICE, apiUrl)
  const store = loadStore()
  if (!store) return
  delete store.sites[apiUrl]
  if (store.active === apiUrl) {
    const remaining = Object.keys(store.sites)
    store.active = remaining[0] ?? ''
  }
  writeStore(store)
}

/** Clear all credentials (disk + keychain). */
export function clearCredentials(): void {
  // Remove all keychain entries before deleting the file
  const store = loadStore()
  if (store) {
    for (const apiUrl of Object.keys(store.sites)) {
      try { deletePassword(KEYCHAIN_SERVICE, apiUrl) } catch { /* ignore */ }
    }
  }
  try {
    rmSync(credentialsPath)
  } catch {
    // Nothing to clear
  }
}

/** Returns an Authorization header object if credentials are available. */
export function getAuthHeaders(): { Authorization: string } | Record<string, never> {
  const creds = loadCredentials()
  if (!creds) return {}
  return { Authorization: `Bearer ${creds.token}` }
}
