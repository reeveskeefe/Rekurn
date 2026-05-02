import type {
  AuditEvent,
  CommitObject,
  DeploymentRecord,
  ObjectDownload,
  Ref,
  RepoSummary,
} from '@rekurn/types'

export interface RekurnClientOptions {
  /** Base URL of the Rekurn API origin, e.g. "https://api.rekurn.com". */
  baseUrl: string
  /** Bearer token. Keep this in memory or a platform secret store, not source code. */
  token?: string
  /** Request timeout in milliseconds. Defaults to 10 seconds. */
  timeoutMs?: number
  /** Retry count for transient failures. Defaults to 2. */
  retries?: number
  /** Custom fetch implementation. Defaults to global fetch. */
  fetch?: typeof globalThis.fetch
  /** Allow http:// for local development. Never enable this in production. */
  allowInsecureHttp?: boolean
}

export interface CreateRepoInput {
  name: string
  description?: string
  visibility?: 'public' | 'private'
  defaultBranch?: string
}

export interface CommitListOptions {
  n?: number
}

export interface UpdateRefInput {
  commitHash: string
  expectedHash?: string | null
  isImmutable?: boolean
}

export interface WantResponse {
  missing: string[]
}

export interface DeployHooksResponse {
  deployHooks: Record<string, string>
}

export interface CreateDeploymentInput {
  commitHash: string
  env: 'production' | 'preview' | 'staging'
  status?: 'pending' | 'building' | 'ready' | 'error' | 'cancelled'
  externalDeploymentId?: string
  externalUrl?: string
  notes?: string
}

export class RekurnApiError extends Error {
  readonly status: number
  readonly code: string | undefined

  constructor(status: number, code: string | undefined, message: string) {
    super(message)
    this.name = 'RekurnApiError'
    this.status = status
    this.code = code
  }
}

export class RekurnClient {
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly retries: number
  private readonly fetchImpl: typeof globalThis.fetch
  private token: string | undefined

  constructor(options: RekurnClientOptions) {
    const url = new URL(options.baseUrl)
    if (url.protocol !== 'https:' && !(options.allowInsecureHttp && url.hostname === 'localhost' || url.hostname === '127.0.0.1')) {
      throw new Error('RekurnClient requires HTTPS baseUrl unless allowInsecureHttp is enabled for localhost')
    }

    this.baseUrl = options.baseUrl.replace(/\/$/, '')
    this.token = options.token
    this.timeoutMs = options.timeoutMs ?? 10_000
    this.retries = options.retries ?? 2
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)
  }

  setToken(token: string | undefined): void {
    this.token = token
  }

  repos = {
    list: (): Promise<RepoSummary[]> => this.request('GET', '/repos'),
    create: (input: CreateRepoInput): Promise<RepoSummary> => this.request('POST', '/repos', input),
    get: (ownerId: string, name: string): Promise<RepoSummary> => this.request('GET', `/repos/${enc(ownerId)}/${enc(name)}`),
    delete: (ownerId: string, name: string): Promise<{ ok: true }> => this.request('DELETE', `/repos/${enc(ownerId)}/${enc(name)}`),
  }

  refs = {
    list: (ownerId: string, repo: string): Promise<{ refs: Ref[] }> => this.request('GET', `/repos/${enc(ownerId)}/${enc(repo)}/refs`),
    update: (ownerId: string, repo: string, refName: string, input: UpdateRefInput): Promise<Ref> => (
      this.request('PUT', `/repos/${enc(ownerId)}/${enc(repo)}/refs/${path(refName)}`, input)
    ),
    delete: (ownerId: string, repo: string, refName: string): Promise<{ ok: true }> => (
      this.request('DELETE', `/repos/${enc(ownerId)}/${enc(repo)}/refs/${path(refName)}`)
    ),
  }

  commits = {
    list: (ownerId: string, repo: string, options: CommitListOptions = {}): Promise<{ commits: CommitObject[] }> => {
      const query = new URLSearchParams()
      if (options.n) query.set('n', String(options.n))
      const suffix = query.size ? `?${query.toString()}` : ''
      return this.request('GET', `/repos/${enc(ownerId)}/${enc(repo)}/commits${suffix}`)
    },
    get: (ownerId: string, repo: string, hash: string): Promise<CommitObject> => (
      this.request('GET', `/repos/${enc(ownerId)}/${enc(repo)}/commits/${enc(hash)}`)
    ),
  }

  objects = {
    want: (ownerId: string, repo: string, hashes: string[]): Promise<WantResponse> => (
      this.request('POST', `/repos/${enc(ownerId)}/${enc(repo)}/objects/want`, { hashes })
    ),
    upload: (ownerId: string, repo: string, hash: string, data: string): Promise<{ ok: true }> => (
      this.request('POST', `/repos/${enc(ownerId)}/${enc(repo)}/objects/upload`, { hash, data })
    ),
    download: (ownerId: string, repo: string, hash: string): Promise<ObjectDownload> => (
      this.request('GET', `/repos/${enc(ownerId)}/${enc(repo)}/objects/${enc(hash)}`)
    ),
    downloadStream: async (ownerId: string, repo: string, hash: string): Promise<ReadableStream<Uint8Array> | null> => {
      const res = await this.raw('GET', `/repos/${enc(ownerId)}/${enc(repo)}/objects/${enc(hash)}`)
      return res.body
    },
  }

  deploy = {
    getHooks: (ownerId: string, repo: string): Promise<DeployHooksResponse> => this.request('GET', `/repos/${enc(ownerId)}/${enc(repo)}/deploy-hooks`),
    setHooks: (ownerId: string, repo: string, deployHooks: Record<string, string>): Promise<DeployHooksResponse> => (
      this.request('PUT', `/repos/${enc(ownerId)}/${enc(repo)}/deploy-hooks`, { deployHooks })
    ),
    list: (ownerId: string, repo: string): Promise<DeploymentRecord[]> => this.request('GET', `/repos/${enc(ownerId)}/${enc(repo)}/deployments`),
    record: (ownerId: string, repo: string, input: CreateDeploymentInput): Promise<DeploymentRecord> => (
      this.request('POST', `/repos/${enc(ownerId)}/${enc(repo)}/deployments`, input)
    ),
  }

  audit = {
    list: (ownerId: string, repo: string): Promise<AuditEvent[]> => this.request('GET', `/repos/${enc(ownerId)}/${enc(repo)}/audit`),
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.raw(method, path, body)
    if (res.status === 204) return undefined as T
    return res.json() as Promise<T>
  }

  async raw(method: string, path: string, body?: unknown): Promise<Response> {
    let lastError: unknown
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
        const res = await this.fetchImpl(`${this.baseUrl}/api/v1${path}`, {
          method,
          headers: this.headers(body),
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        })
        clearTimeout(timeout)

        if (res.ok) return res
        if (!isRetryable(res.status) || attempt === this.retries) throw await toApiError(res)
      } catch (err) {
        lastError = err
        if (err instanceof RekurnApiError || attempt === this.retries) throw sanitizeError(err)
      }
      await sleep(150 * 2 ** attempt)
    }
    throw sanitizeError(lastError)
  }

  private headers(body: unknown): Record<string, string> {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (this.token) headers.Authorization = `Bearer ${this.token}`
    return headers
  }
}

async function toApiError(res: Response): Promise<RekurnApiError> {
  let message = `Request failed with status ${res.status}`
  let code: string | undefined
  try {
    const json = await res.json() as { error?: string; code?: string }
    if (json.error) message = sanitizeMessage(json.error)
    code = json.code
  } catch {
    // Keep sanitized default.
  }
  return new RekurnApiError(res.status, code, message)
}

function sanitizeError(err: unknown): Error {
  if (err instanceof RekurnApiError) return err
  if (err instanceof DOMException && err.name === 'AbortError') return new Error('Request timed out')
  return new Error('Network request failed')
}

function sanitizeMessage(message: string): string {
  return message.replace(/\/[^\s]+/g, '[path]').slice(0, 300)
}

function isRetryable(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function enc(value: string): string {
  return encodeURIComponent(value)
}

function path(value: string): string {
  return value.split('/').map(enc).join('/')
}
