import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'

export interface Credentials {
  token: string
  email: string
  userId: string
  apiUrl: string
  savedAt: string
}

const credentialsDir = join(homedir(), '.rekurn')
const credentialsPath = join(credentialsDir, 'credentials.json')

export function loadCredentials(): Credentials | null {
  try {
    const raw = readFileSync(credentialsPath, 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    if (
      parsed &&
      typeof parsed === 'object' &&
      'token' in parsed &&
      'email' in parsed &&
      'userId' in parsed &&
      'apiUrl' in parsed
    ) {
      return parsed as Credentials
    }
  } catch {
    // File doesn't exist or is malformed — treat as not logged in
  }
  return null
}

export function saveCredentials(creds: Credentials): void {
  mkdirSync(credentialsDir, { recursive: true })
  writeFileSync(credentialsPath, JSON.stringify(creds, null, 2), { mode: 0o600 })
}

export function clearCredentials(): void {
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
