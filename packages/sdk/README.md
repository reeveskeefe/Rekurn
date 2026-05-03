# @reeveskeefe/rekurn-sdk

Install:

```bash
npm install @reeveskeefe/rekurn-sdk
```

Use:

```ts
import { RekurnClient } from '@reeveskeefe/rekurn-sdk'

const rekurn = new RekurnClient({
  baseUrl: 'https://yoursite.com', // any site running the Rekurn API
  token: process.env.REKURN_TOKEN,
})

const repos = await rekurn.repos.list()
```

Rekurn is self-hosted — there is no central rekurn.com. `baseUrl` is the URL
of whatever site is running the Rekurn API. A token can be obtained by logging
in with the CLI (`rekurn login`) or issued server-side via the API.

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `baseUrl` | `string` | required | Base URL of the Rekurn API origin |
| `token` | `string` | — | Bearer token for authenticated requests |
| `timeoutMs` | `number` | `10000` | Request timeout in ms |
| `retries` | `number` | `2` | Retry count for transient failures (408, 429, 5xx) |
| `fetch` | `typeof fetch` | global fetch | Custom fetch implementation |
| `allowInsecureHttp` | `boolean` | `false` | Allow `http://` for `localhost` only |

## API surface

```ts
rekurn.repos.list()
rekurn.repos.create({ name, description?, visibility?, defaultBranch? })
rekurn.repos.get(ownerId, name)
rekurn.repos.delete(ownerId, name)

rekurn.refs.list(ownerId, repo)
rekurn.refs.update(ownerId, repo, refName, { commitHash, expectedHash?, isImmutable? })
rekurn.refs.delete(ownerId, repo, refName)

rekurn.commits.list(ownerId, repo, { n? })
rekurn.commits.get(ownerId, repo, hash)

rekurn.objects.want(ownerId, repo, hashes)
rekurn.objects.upload(ownerId, repo, hash, data)
rekurn.objects.uploadBatch(ownerId, repo, objects)
rekurn.objects.download(ownerId, repo, hash)
rekurn.objects.downloadBatch(ownerId, repo, hashes)
rekurn.objects.downloadStream(ownerId, repo, hash)  // → ReadableStream | null

rekurn.deploy.getHooks(ownerId, repo)
rekurn.deploy.setHooks(ownerId, repo, deployHooks)
rekurn.deploy.list(ownerId, repo)
rekurn.deploy.record(ownerId, repo, input)

rekurn.audit.list(ownerId, repo)

rekurn.setToken(token)  // swap the bearer token at runtime
```

Errors throw `RekurnApiError` with `.status` (HTTP status) and `.code`
(optional API error code) properties.

The SDK is ESM, dependency-free at runtime, tree-shakable, and ships
TypeScript declarations.

## License

Apache 2.0
