/**
 * Authenticated HTTP helpers for the Rekurn API.
 *
 * All requests automatically:
 *  - Attach Authorization: Bearer <token> from saved credentials.
 *  - On 401: attempt a token refresh via POST /api/auth/refresh-token.
 *    If refresh succeeds the original request is retried once with the new token.
 *    If refresh also fails the user is prompted to run `rekurn login` and the
 *    process exits with code 1.
 */
import chalk from 'chalk'
import { getAuthHeaders, loadCredentials, updateAccessToken, getRefreshToken } from './credentials.js'

function apiUrl(): string {
  const url = process.env.REKURN_API_URL ?? loadCredentials()?.apiUrl
  if (!url) {
    console.error('No Rekurn API URL configured. Run: rekurn login https://api.your-site.com')
    process.exit(1)
  }
  return url.replace(/\/$/, '')
}

function promptRelogin(base: string): never {
  console.error(chalk.red('\nYour session has expired.'))
  console.error(chalk.dim(`Run: rekurn login ${base}`))
  process.exit(1)
}

async function tryRefresh(base: string): Promise<string | null> {
  const refreshToken = getRefreshToken(base)
  if (!refreshToken) return null
  try {
    const res = await fetch(`${base}/api/auth/refresh-token`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${refreshToken}` },
    })
    if (!res.ok) return null
    const data = await res.json() as { token?: string }
    return data.token ?? null
  } catch {
    return null
  }
}

/**
 * Run a fetch, intercept 401, attempt one refresh+retry, then give up.
 * `buildInit` is called fresh before each attempt so it picks up the
 * updated Authorization header after a keychain write.
 */
async function fetchWithRefresh(
  base: string,
  fullUrl: string,
  buildInit: () => RequestInit,
): Promise<Response> {
  const response = await fetch(fullUrl, buildInit())
  if (response.status !== 401) return response

  const newToken = await tryRefresh(base)
  if (!newToken) promptRelogin(base)

  updateAccessToken(base, newToken)
  return fetch(fullUrl, buildInit())
}

export async function apiGet(path: string, init?: RequestInit): Promise<Response> {
  const base = apiUrl()
  return fetchWithRefresh(base, `${base}${path}`, () => ({
    ...init,
    method: 'GET',
    headers: {
      ...getAuthHeaders(),
      ...(init?.headers as Record<string, string> | undefined),
    },
  }))
}

export async function apiPost(
  path: string,
  body?: unknown,
  init?: RequestInit,
): Promise<Response> {
  const base = apiUrl()
  return fetchWithRefresh(base, `${base}${path}`, () => ({
    ...init,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...(init?.headers as Record<string, string> | undefined),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }))
}

export async function apiDelete(path: string, init?: RequestInit): Promise<Response> {
  const base = apiUrl()
  return fetchWithRefresh(base, `${base}${path}`, () => ({
    ...init,
    method: 'DELETE',
    headers: {
      ...getAuthHeaders(),
      ...(init?.headers as Record<string, string> | undefined),
    },
  }))
}

export async function apiPut(
  path: string,
  body?: unknown,
  init?: RequestInit,
): Promise<Response> {
  const base = apiUrl()
  return fetchWithRefresh(base, `${base}${path}`, () => ({
    ...init,
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...(init?.headers as Record<string, string> | undefined),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }))
}
