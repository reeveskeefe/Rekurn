/**
 * Authenticated HTTP helpers for the Rekurn API.
 *
 * Reads REKURN_API_URL from the environment (defaults to https://api.rekurn.com).
 * Attaches Authorization: Bearer <token> when credentials are saved locally.
 */
import { getAuthHeaders } from './credentials.js'

const DEFAULT_API_URL = 'https://api.rekurn.com'

function apiUrl(): string {
  return (process.env.REKURN_API_URL ?? DEFAULT_API_URL).replace(/\/$/, '')
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
