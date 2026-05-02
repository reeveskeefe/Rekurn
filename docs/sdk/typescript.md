# Rekurn TypeScript SDK

```bash
pnpm add @rekurn/sdk
```

```ts
import { RekurnClient } from '@rekurn/sdk'

const rekurn = new RekurnClient({
  baseUrl: 'https://api.rekurn.com',
  token: process.env.REKURN_TOKEN,
})

const repos = await rekurn.repos.list()
const refs = await rekurn.refs.list('owner-user-id', 'my-repo')
const commit = await rekurn.commits.get('owner-user-id', 'my-repo', refs.refs[0].commitHash)
```

The SDK is fetch-only, ESM, tree-shakable, and enforces HTTPS unless `allowInsecureHttp` is enabled for localhost development.
