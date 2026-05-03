# Rekurn

Rekurn is a lightweight versioning and release system built for modern TypeScript projects, self-hosted infrastructure, and Vercel-style deployments. It works like Git in spirit, with familiar local commands for commits, branches, pushes, pulls, merges, snapshots, verification, and deployment hooks, while keeping the system small enough to adapt to your own applications.

<img src="RekurnLogo.png" alt="Rekurn logo">

Rekurn was built for oreulius.com so our own sites can have an independent repository, retrieval, and release workflow. The public goal is broader: provide a clean CLI and SDK that can be bolted into existing hosted projects when Git or heavier versioning workflows are not the right fit.

## Install

Install the CLI globally:

```bash
npm install -g rekurn@0.2.5
```

Or run it directly:

```bash
npx rekurn@0.2.5 --help
```

Install the SDK:

```bash
npm install @reeveskeefe/rekurn-sdk@0.2.5
```

## CLI

Initialize a repository:

```bash
rekurn init
rekurn add .
rekurn commit -m "initial commit"
```

Work with branches and history:

```bash
rekurn branch feature
rekurn return feature
rekurn log --oneline
rekurn timeline
```

Configure a remote and push securely:

```bash
rekurn login
rekurn remote set https://your-site.com/<username>/<repo-name>
rekurn push origin main
```

### Login

Rekurn has no centralized login server. Every site that runs the Rekurn API is independent. When you run `rekurn login` for the first time you will be prompted for the URL of the site you want to connect to:

```bash
rekurn login
```

<img src="packages/sdk/assets/login.png">

Enter the base URL of any site running the Rekurn API (for example `https://oreulius.com`). Rekurn opens a magic-link authentication flow in your browser. Once you confirm your email, the CLI receives the session token and stores it in your OS keychain — nothing is written to disk in plain text.

You can be logged into multiple sites at the same time. Each site gets its own keychain entry keyed by its URL. Rekurn automatically switches context based on the remote configured for the current repository.

If you need a reminder of how to set things up, run:

```bash
rekurn settings
```

<img src="packages/sdk/assets/SETUP.png">

### Session refresh

Sessions are long-lived but will eventually expire. When that happens, Rekurn automatically attempts to refresh your token in the background. If refresh fails you will see:

```
Your session has expired.
Run: rekurn login https://your-site.com
```

### Other commands

For signed push certificates, configure an Ed25519 secret key seed:

```bash
rekurn config signing-key ~/.rekurn/keys/push-ed25519
rekurn push origin main
```

Create immutable snapshots:

```bash
rekurn snapshot v1.0.0
rekurn return @v1.0.0 --preview
```

Merge branches:

```bash
rekurn merge feature
```

Verify repository integrity:

```bash
rekurn verify
```

Configure and trigger deployments:

```bash
rekurn config deploy-hook production https://example.com/deploy
rekurn deploy production @v1.0.0
rekurn rollback @v1.0.0
```

## SDK

```ts
import { RekurnClient } from '@reeveskeefe/rekurn-sdk'

const rekurn = new RekurnClient({
  baseUrl: 'https://your-site.com',
  token: process.env.REKURN_TOKEN,
})

const repos = await rekurn.repos.list()
```

The SDK is ESM, dependency-free at runtime, tree-shakable, and includes TypeScript declarations. It enforces HTTPS by default, supports request timeouts, retries transient failures with backoff, and sanitizes API errors. See [packages/sdk/README.md](packages/sdk/README.md) for the full API reference.

## Packages

- `rekurn` — CLI package for global installs and npx.
- `@reeveskeefe/rekurn-sdk` — TypeScript SDK for applications and integrations.

The monorepo also contains internal packages for core object handling, crypto, diffing, API routes, and database schema.

## Security

Rekurn uses content-addressed objects and verifies object hashes before storage. Sensitive operations such as object upload, ref updates, deploy hook updates, and deployment recording require write access. All stored objects are private by default and are served through signed URLs. Public API routes are rate-limited using a database-backed limiter.

Push uses bearer-token authentication, HTTPS remote enforcement, compare-and-swap ref updates, object hash validation, and optional Ed25519 signed push certificates. Localhost HTTP remotes are only allowed when `REKURN_ALLOW_INSECURE_REMOTE=1` is set for development.

Session tokens are stored exclusively in the OS keychain (macOS Keychain, Linux Secret Service / encrypted vault, Windows DPAPI). They are never written to disk in plain text.

Do not commit API tokens, deploy hooks, private keys, signing keys, or production `.rekurn/config` files.

## Development and Contributing

Install dependencies:

```bash
pnpm install
```

Run type checks:

```bash
pnpm type-check
```

Run tests:

```bash
pnpm test
```

Build publishable packages before release or when changing CLI/SDK packaging:

```bash
pnpm --filter rekurn build
pnpm --filter @reeveskeefe/rekurn-sdk build
```

## License

Apache-2.0
