/**
 * Authenticated HTTP helpers for the Rekurn API.
 *
 * Reads REKURN_API_URL from the environment (defaults to https://api.rekurn.com).
 * Attaches Authorization: Bearer <token> when credentials are saved locally.
 */
import { getAuthHeaders, loadCredentials } from './credentials.js'

function apiUrl(): string {
  // Priority: explicit env var > saved credentials > error
  const url = process.env.REKURN_API_URL ?? loadCredentials()?.apiUrl
  if (!url) {
    console.error('No Rekurn API URL configured. Run: rekurn login https://api.your-site.com')
    process.exit(1)
  }
  return url.replace(/\/$/, '')
}

export async function apiGet(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${apiUrl()}${path}`, {
    ...init,
    method: 'GET',
    headers: {
      ...getAuthHeaders(),
      ...(init?.headers as Record<string, string> | undefined),
    },
  })
}

export async function apiPost(
  path: string,
  body?: unknown,
  init?: RequestInit,
): Promise<Response> {
  return fetch(`${apiUrl()}${path}`, {
    ...init,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...(init?.headers as Record<string, string> | undefined),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

export async function apiDelete(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${apiUrl()}${path}`, {
    ...init,
    method: 'DELETE',
    headers: {
      ...getAuthHeaders(),
      ...(init?.headers as Record<string, string> | undefined),
    },
  })
}

export async function apiPut(
  path: string,
  body?: unknown,
  init?: RequestInit,
): Promise<Response> {
  return fetch(`${apiUrl()}${path}`, {
    ...init,
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...(init?.headers as Record<string, string> | undefined),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}
