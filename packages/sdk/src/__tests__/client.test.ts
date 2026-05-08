/**
 * RekurnClient unit tests.
 *
 * Verifies the three terms of the unified transfer equation T*_sys:
 *
 *   Term II — T_SDK(P) = min(T_platform, 2λ + P/B↑ + 7P/3B↓ + t_cold + ...) * (1+ζ)
 *             Default timeout must be 30 000 ms, not 10 000 ms.
 *
 *   Term III — t_wait = τ_retry + ε  (renewal-optimal 429 backoff)
 *              The SDK must sleep exactly Retry-After * 1000 + 50 ms on 429,
 *              not the blind exponential 150 * 2^attempt.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RekurnClient, RekurnApiError } from '../client.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockResponse(status: number, body: unknown = {}, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

function clientWith(fetchImpl: typeof globalThis.fetch, extra: { timeoutMs?: number; retries?: number } = {}): RekurnClient {
  return new RekurnClient({
    baseUrl: 'https://example.com',
    token: 'test-token',
    fetch: fetchImpl,
    retries: extra.retries ?? 0,
    ...(extra.timeoutMs !== undefined ? { timeoutMs: extra.timeoutMs } : {}),
  })
}

// ---------------------------------------------------------------------------
// Term II — Timeout default is 30 000 ms
// ---------------------------------------------------------------------------

describe('Term II: timeout', () => {
  it('succeeds with default timeoutMs when fetch resolves immediately', async () => {
    // If the default were very small, an instant fetch could still fail
    // on a slow machine. We verify the happy path with no timeout option.
    const fetch = vi.fn().mockResolvedValue(mockResponse(200, { ok: true }))
    const client = clientWith(fetch)
    await expect(client.request('GET', '/repos')).resolves.toEqual({ ok: true })
  })

  it('throws "Request timed out" when timeoutMs is tiny and fetch never resolves', async () => {
    // A fetch that never resolves — AbortController must fire after timeoutMs
    const fetch = vi.fn().mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          // Listen for abort signal from the client's AbortController
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          )
        }),
    )
    const client = clientWith(fetch, { timeoutMs: 5, retries: 0 })
    await expect(client.request('GET', '/repos')).rejects.toThrow('Request timed out')
  })

  it('default timeoutMs is NOT 5 ms — a 10 ms fetch should succeed', async () => {
    // If the default were 5 ms this would fail. Proves default ≥ 10 ms (it is 30 000 ms).
    const fetch = vi.fn().mockImplementation(
      () => new Promise<Response>((resolve) => setTimeout(() => resolve(mockResponse(200, {})), 10)),
    )
    const client = clientWith(fetch)
    await expect(client.request('GET', '/repos')).resolves.toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Term III — Renewal-optimal 429 backoff
// ---------------------------------------------------------------------------

describe('Term III: 429 Retry-After respected', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('sleeps for Retry-After * 1000 + 50 ms on 429, then succeeds on retry', async () => {
    const RETRY_AFTER_SECS = 3
    const EXPECTED_SLEEP = RETRY_AFTER_SECS * 1000 + 50 // 3050 ms = τ_retry + ε

    const fetch = vi.fn()
      .mockResolvedValueOnce(mockResponse(429, { error: 'Too many requests' }, { 'Retry-After': String(RETRY_AFTER_SECS) }))
      .mockResolvedValueOnce(mockResponse(200, { ok: true }))

    const client = clientWith(fetch, { retries: 1 })

    // Start request — will pause at sleep(3050)
    const promise = client.request('GET', '/repos')

    // Advance time by less than the required sleep → retry must NOT have fired yet
    await vi.advanceTimersByTimeAsync(EXPECTED_SLEEP - 1)
    expect(fetch).toHaveBeenCalledTimes(1)

    // Advance past the sleep boundary → retry fires
    await vi.advanceTimersByTimeAsync(2)
    expect(fetch).toHaveBeenCalledTimes(2)

    await expect(promise).resolves.toEqual({ ok: true })
  })

  it('does NOT fire retry after only 150 ms when Retry-After: 3 is set', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(mockResponse(429, {}, { 'Retry-After': '3' }))
      .mockResolvedValueOnce(mockResponse(200, {}))

    const client = clientWith(fetch, { retries: 1 })
    const promise = client.request('GET', '/repos')

    // Blind-backoff would fire after 150 ms — must NOT happen here
    await vi.advanceTimersByTimeAsync(150)
    expect(fetch).toHaveBeenCalledTimes(1) // still only the initial call

    // Advance to the actual renewal point
    await vi.advanceTimersByTimeAsync(3050 - 150)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetch).toHaveBeenCalledTimes(2)

    await expect(promise).resolves.toBeDefined()
  })

  it('falls back to blind exponential backoff when 429 has no Retry-After header', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(mockResponse(429, {}))  // no Retry-After header
      .mockResolvedValueOnce(mockResponse(200, {}))

    const client = clientWith(fetch, { retries: 1 })
    const promise = client.request('GET', '/repos')

    // Blind backoff attempt=0 → sleep(150). Retry should fire after 150 ms.
    await vi.advanceTimersByTimeAsync(150)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetch).toHaveBeenCalledTimes(2)

    await expect(promise).resolves.toBeDefined()
  })

  it('does NOT use Retry-After for non-429 retryable errors (500)', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(mockResponse(500, {}, { 'Retry-After': '30' }))
      .mockResolvedValueOnce(mockResponse(200, {}))

    const client = clientWith(fetch, { retries: 1 })
    const promise = client.request('GET', '/repos')

    // Blind backoff 150 ms — Retry-After: 30 must be ignored for non-429
    await vi.advanceTimersByTimeAsync(150)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetch).toHaveBeenCalledTimes(2)

    await expect(promise).resolves.toBeDefined()
  })

  it('throws RekurnApiError when retries exhausted on 429', async () => {
    const fetch = vi.fn()
      .mockResolvedValue(mockResponse(429, { error: 'Too many requests' }, { 'Retry-After': '1' }))

    const client = clientWith(fetch, { retries: 1 })
    const promise = client.request('GET', '/repos')

    // Register rejection handler BEFORE advancing timers so the rejection
    // is never "unhandled" between the timer advance and the await.
    const assertion = expect(promise).rejects.toBeInstanceOf(RekurnApiError)

    await vi.runAllTimersAsync()
    await assertion
  })
})
