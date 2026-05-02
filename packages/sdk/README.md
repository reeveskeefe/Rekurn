# @rekurn/sdk

Install:

```bash
npm install @rekurn/sdk
```

Use:

```ts
import { RekurnClient } from '@rekurn/sdk'

const rekurn = new RekurnClient({
  baseUrl: 'https://api.rekurn.com',
  token: process.env.REKURN_TOKEN,
})

const repos = await rekurn.repos.list()
```

The SDK is ESM, dependency-free at runtime, tree-shakable, and includes
TypeScript declarations.
