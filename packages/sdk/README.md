# @reeveskeefe/rekurn-sdk

Install:

```bash
npm install @reeveskeefe/rekurn-sdk
```

Use:

```ts
import { RekurnClient } from '@reeveskeefe/rekurn-sdk'

const rekurn = new RekurnClient({
  baseUrl: 'https://api.rekurn.com',
  token: process.env.REKURN_TOKEN,
})

const repos = await rekurn.repos.list()
```

The SDK is ESM, dependency-free at runtime, tree-shakable, and includes
TypeScript declarations.
