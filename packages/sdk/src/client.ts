import type { CommitObject, TreeObject, Ref } from '@rekurn/types'

// ---------------------------------------------------------------------------
// Client configuration
// ---------------------------------------------------------------------------

export interface RekurnClientOptions {
  /** Base URL of the Rekurn API, e.g. "https://oreulius.com" */
  baseUrl: string
  /**
   * Bearer token for authentication.
   * Obtain via rekurn login → JWT, or by creating an API key.
   */
  token?: string
  /** Custom fetch implementation (defaults to global fetch). */
  fetch?: typeof globalThis.fetch
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class RekurnApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | undefined,
    message: string,
  ) {
    super(message)
    this.name = 'RekurnApiError'
  }
}

// ---------------------------------------------------------------------------
// Core client
// ---------------------------------------------------------------------------

export class RekurnClient {
  private readonly baseUrl: string
  private token: string | undefined
  private readonly _fetch: typeof globalThis.fetch

  /** Sub-namespaces for grouping related methods. */
  readonly repos: ReposMethods
  readonly commits: CommitsMethods
  readonly refs: RefsMethods
  readonly objects: ObjectsMethods

  constructor(options: RekurnClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
    this.token = options.token
    this._fetch = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.repos = new ReposMethods(this)
    this.commits = new CommitsMethods(this)
    this.refs = new RefsMethods(this)
    this.objects = new ObjectsMethods(this)
  }

  /** Update the auth token (e.g. after a token refresh). */
  setToken(token: string): void {
    this.token = token
  }

  /** Internal: make an authenticated JSON request. */
  async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}/api/v1${path}`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`

    const res = await this._fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

    if (!res.ok) {
      let errorMessage = `HTTP ${res.status}`
      let code: string | undefined
      try {
        const json = (await res.json()) as { error?: string; code?: string }
        errorMessage = json.error ?? errorMessage
        code = json.code
      } catch {
        // ignore JSON parse failure
      }
      throw new RekurnApiError(res.status, code, errorMessage)
    }

    return res.json() as Promise<T>
  }
}

// ---------------------------------------------------------------------------
// Repos
// ---------------------------------------------------------------------------

export interface RepoSummary {
  id: string
  name: string
  description: string | null
  visibility: 'public' | 'private'
  defaultBranch: string
  createdAt: string
}

export interface CreateRepoInput {
  name: string
  description?: string
  visibility?: 'public' | 'private'
  defaultBranch?: string
}

class ReposMethods {
  constructor(private readonly client: RekurnClient) {}

  list(): Promise<RepoSummary[]> {
    return this.client.request('GET', '/repos')
  }

  get(repoName: string): Promise<RepoSummary> {
    return this.client.request('GET', `/${repoName}`)
  }

  create(input: CreateRepoInput): Promise<RepoSummary> {
    return this.client.request('POST', '/repos', input)
  }

  delete(repoName: string): Promise<void> {
    return this.client.request('DELETE', `/${repoName}`)
  }
}

// ---------------------------------------------------------------------------
// Commits
// ---------------------------------------------------------------------------

export interface CommitListOptions {
  ref?: string
  n?: number
  before?: string
}

class CommitsMethods {
  constructor(private readonly client: RekurnClient) {}

  list(repoName: string, options: CommitListOptions = {}): Promise<CommitObject[]> {
    const params = new URLSearchParams()
    if (options.ref) params.set('ref', options.ref)
    if (options.n) params.set('n', String(options.n))
    if (options.before) params.set('before', options.before)
    const qs = params.toString() ? `?${params.toString()}` : ''
    return this.client.request('GET', `/${repoName}/commits${qs}`)
  }

  get(repoName: string, hash: string): Promise<CommitObject> {
    return this.client.request('GET', `/${repoName}/commits/${hash}`)
  }
}

// ---------------------------------------------------------------------------
// Refs
// ---------------------------------------------------------------------------

class RefsMethods {
  constructor(private readonly client: RekurnClient) {}

  list(repoName: string): Promise<Ref[]> {
    return this.client.request('GET', `/${repoName}/refs`)
  }

  update(repoName: string, refName: string, commitHash: string): Promise<Ref> {
    return this.client.request('PUT', `/${repoName}/refs/${refName}`, { commitHash })
  }

  delete(repoName: string, refName: string): Promise<void> {
    return this.client.request('DELETE', `/${repoName}/refs/${refName}`)
  }
}

// ---------------------------------------------------------------------------
// Objects
// ---------------------------------------------------------------------------

export interface WantResponse {
  /** Hashes the server needs — client should upload these. */
  missing: string[]
}

class ObjectsMethods {
  constructor(private readonly client: RekurnClient) {}

  /** Ask the server which of the provided hashes it is missing. */
  want(repoName: string, hashes: string[]): Promise<WantResponse> {
    return this.client.request('POST', `/${repoName}/objects/want`, { hashes })
  }

  /** Get the tree contents for a given hash. */
  getTree(repoName: string, hash: string): Promise<TreeObject> {
    return this.client.request('GET', `/${repoName}/tree/${hash}`)
  }
}
