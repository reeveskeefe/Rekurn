/**
 * OS keychain helpers — no external dependencies.
 *
 * Platform implementations:
 *   macOS   — `security` CLI  (ships with every Mac)
 *   Linux   — `secret-tool`   (GNOME keyring); falls back to AES-256-CBC
 *             encrypted vault at ~/.rekurn/.vault keyed on /etc/machine-id
 *   Windows — PowerShell DPAPI (machine-scoped; no UI prompt)
 *
 * API mirrors the minimal subset of `keytar`:
 *   getPassword(service, account)            → string | null
 *   setPassword(service, account, password)  → void
 *   deletePassword(service, account)         → void
 */

import { execFileSync } from 'node:child_process'
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// macOS — `security` CLI
// ---------------------------------------------------------------------------

function macosGet(service: string, account: string): string | null {
  try {
    const out = execFileSync(
      'security',
      ['find-generic-password', '-s', service, '-a', account, '-w'],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
    return out.trim() || null
  } catch {
    return null
  }
}

function macosSet(service: string, account: string, password: string): void {
  // Delete first so re-saves don't prompt for permission
  try {
    execFileSync(
      'security',
      ['delete-generic-password', '-s', service, '-a', account],
      { stdio: 'ignore' },
    )
  } catch {
    // Not present yet — fine
  }
  execFileSync(
    'security',
    ['add-generic-password', '-s', service, '-a', account, '-w', password],
    { stdio: 'ignore' },
  )
}

function macosDelete(service: string, account: string): void {
  try {
    execFileSync(
      'security',
      ['delete-generic-password', '-s', service, '-a', account],
      { stdio: 'ignore' },
    )
  } catch {
    // Not present — fine
  }
}

// ---------------------------------------------------------------------------
// Linux — secret-tool (GNOME keyring) with encrypted-file fallback
// ---------------------------------------------------------------------------

function linuxGet(service: string, account: string): string | null {
  try {
    const out = execFileSync(
      'secret-tool',
      ['lookup', 'service', service, 'account', account],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
    return out.trim() || null
  } catch {
    return vaultGet(service, account)
  }
}

function linuxSet(service: string, account: string, password: string): void {
  try {
    const proc = execFileSync(
      'secret-tool',
      ['store', '--label', `${service}:${account}`, 'service', service, 'account', account],
      { input: password, encoding: 'utf-8', stdio: ['pipe', 'ignore', 'pipe'] },
    )
    void proc
  } catch {
    vaultSet(service, account, password)
  }
}

function linuxDelete(service: string, account: string): void {
  try {
    execFileSync(
      'secret-tool',
      ['clear', 'service', service, 'account', account],
      { stdio: 'ignore' },
    )
  } catch {
    vaultDelete(service, account)
  }
}

// ---------------------------------------------------------------------------
// Linux fallback — AES-256-CBC encrypted vault keyed on /etc/machine-id
// ---------------------------------------------------------------------------

const VAULT_PATH = join(homedir(), '.rekurn', '.vault')
const CIPHER = 'aes-256-cbc' as const

function machineKey(): Buffer {
  let seed = 'rekurn-fallback-key'
  try {
    seed = readFileSync('/etc/machine-id', 'utf-8').trim()
  } catch {
    // /etc/machine-id not available — use hostname as a weaker fallback
    try {
      seed = execFileSync('hostname', [], { encoding: 'utf-8' }).trim()
    } catch { /* give up and use default seed */ }
  }
  return createHash('sha256').update(seed).digest()
}

function vaultLoad(): Record<string, string> {
  if (!existsSync(VAULT_PATH)) return {}
  try {
    const raw = readFileSync(VAULT_PATH)
    const iv = raw.subarray(0, 16)
    const ciphertext = raw.subarray(16)
    const decipher = createDecipheriv(CIPHER, machineKey(), iv)
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return JSON.parse(plain.toString('utf-8')) as Record<string, string>
  } catch {
    return {}
  }
}

function vaultSave(store: Record<string, string>): void {
  const dir = join(homedir(), '.rekurn')
  mkdirSync(dir, { recursive: true })
  const iv = randomBytes(16)
  const cipher = createCipheriv(CIPHER, machineKey(), iv)
  const plain = Buffer.from(JSON.stringify(store), 'utf-8')
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()])
  writeFileSync(VAULT_PATH, Buffer.concat([iv, encrypted]), { mode: 0o600 })
}

function vaultKey(service: string, account: string): string {
  return `${service}\x00${account}`
}

function vaultGet(service: string, account: string): string | null {
  return vaultLoad()[vaultKey(service, account)] ?? null
}

function vaultSet(service: string, account: string, password: string): void {
  const store = vaultLoad()
  store[vaultKey(service, account)] = password
  vaultSave(store)
}

function vaultDelete(service: string, account: string): void {
  const store = vaultLoad()
  delete store[vaultKey(service, account)]
  if (Object.keys(store).length === 0) {
    try { rmSync(VAULT_PATH) } catch { /* already gone */ }
  } else {
    vaultSave(store)
  }
}

// ---------------------------------------------------------------------------
// Windows — PowerShell DPAPI (machine-scoped; no pop-up)
// ---------------------------------------------------------------------------

function winGet(service: string, account: string): string | null {
  const label = `${service}:${account}`
  const script = `
$path = "$env:USERPROFILE\\.rekurn\\dpapi.json"
if (-not (Test-Path $path)) { exit 1 }
$store = Get-Content $path -Raw | ConvertFrom-Json
$entry = $store | Where-Object { $_.label -eq "${label.replace(/"/g, '`"')}" }
if (-not $entry) { exit 1 }
$bytes = [System.Convert]::FromBase64String($entry.data)
$plain = [System.Security.Cryptography.ProtectedData]::Unprotect(
  $bytes, $null,
  [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[System.Text.Encoding]::UTF8.GetString($plain)
`.trim()
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command', script], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return out.trim() || null
  } catch {
    return null
  }
}

function winSet(service: string, account: string, password: string): void {
  const label = `${service}:${account}`
  const script = `
Add-Type -AssemblyName System.Security
$path = "$env:USERPROFILE\\.rekurn\\dpapi.json"
$null = New-Item -ItemType Directory -Force (Split-Path $path)
$store = @()
if (Test-Path $path) {
  $store = Get-Content $path -Raw | ConvertFrom-Json
  $store = @($store | Where-Object { $_.label -ne "${label.replace(/"/g, '`"')}" })
}
$plain = [System.Text.Encoding]::UTF8.GetBytes("${password.replace(/"/g, '`"')}")
$encrypted = [System.Security.Cryptography.ProtectedData]::Protect(
  $plain, $null,
  [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
$entry = [PSCustomObject]@{ label = "${label.replace(/"/g, '`"')}"; data = [System.Convert]::ToBase64String($encrypted) }
$store += $entry
$store | ConvertTo-Json | Set-Content -Encoding UTF8 $path
`.trim()
  execFileSync('powershell', ['-NoProfile', '-Command', script], {
    stdio: ['ignore', 'ignore', 'pipe'],
  })
}

function winDelete(service: string, account: string): void {
  const label = `${service}:${account}`
  const script = `
$path = "$env:USERPROFILE\\.rekurn\\dpapi.json"
if (-not (Test-Path $path)) { exit 0 }
$store = Get-Content $path -Raw | ConvertFrom-Json
$store = @($store | Where-Object { $_.label -ne "${label.replace(/"/g, '`"')}" })
$store | ConvertTo-Json | Set-Content -Encoding UTF8 $path
`.trim()
  try {
    execFileSync('powershell', ['-NoProfile', '-Command', script], { stdio: 'ignore' })
  } catch { /* not present */ }
}

// ---------------------------------------------------------------------------
// Public API — dispatches to the right backend
// ---------------------------------------------------------------------------

export function getPassword(service: string, account: string): string | null {
  switch (process.platform) {
    case 'darwin': return macosGet(service, account)
    case 'linux':  return linuxGet(service, account)
    case 'win32':  return winGet(service, account)
    default:       return vaultGet(service, account)
  }
}

export function setPassword(service: string, account: string, password: string): void {
  switch (process.platform) {
    case 'darwin': return macosSet(service, account, password)
    case 'linux':  return linuxSet(service, account, password)
    case 'win32':  return winSet(service, account, password)
    default:       return vaultSet(service, account, password)
  }
}

export function deletePassword(service: string, account: string): void {
  switch (process.platform) {
    case 'darwin': return macosDelete(service, account)
    case 'linux':  return linuxDelete(service, account)
    case 'win32':  return winDelete(service, account)
    default:       return vaultDelete(service, account)
  }
}
