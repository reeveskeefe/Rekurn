import chalk from 'chalk'
import { loadCredentials } from '../lib/credentials.js'
import { getRemote } from '../lib/remote.js'
import {
  currentBranch,
  readCommitFromCache,
  readConfig,
  requireRepoRoot,
  resolveHEAD,
} from '../lib/repo.js'
import { resolveSelector } from '../lib/selectors.js'

export interface DeployOptions {
  env?: string
  notes?: string
  rollback?: boolean
}

export async function deployCommand(
  environmentOrRef: string | undefined,
  refArg: string | undefined,
  options: DeployOptions = {},
): Promise<void> {
  const repoRoot = requireRepoRoot()
  const config = readConfig(repoRoot)
  const environment = options.env ?? inferEnvironment(environmentOrRef, refArg)
  const ref = inferRef(environmentOrRef, refArg, options.env)
  const hookUrl = config.deployHooks?.[environment]

  if (!hookUrl) {
    console.error(chalk.red(`no deploy hook configured for '${environment}'`))
    console.error(chalk.dim(`  Run: rekurn config deploy-hook ${environment} <url>`))
    process.exit(1)
  }

  const resolvedHash = ref ? resolveSelector(repoRoot, ref)?.hash : resolveHEAD(repoRoot)
  if (!resolvedHash) {
    console.error(chalk.red(`error: '${ref ?? 'HEAD'}' did not resolve to a commit`))
    process.exit(1)
  }

  const commit = readCommitFromCache(repoRoot, resolvedHash)
  if (!commit) {
    console.error(chalk.red(`fatal: commit ${resolvedHash.slice(0, 7)} is missing from local cache`))
    process.exit(1)
  }

  const payload = {
    commitHash: resolvedHash,
    ref: ref ?? currentBranch(repoRoot) ?? 'HEAD',
    message: commit.message,
    author: commit.author,
    timestamp: commit.author.timestamp,
    environment,
    rollback: options.rollback === true,
  }

  const hookResult = await triggerHook(hookUrl, payload)
  await recordDeployment(repoRoot, {
    commitHash: resolvedHash,
    env: environment,
    status: hookResult.ok ? 'ready' : 'error',
    externalDeploymentId: hookResult.externalDeploymentId,
    externalUrl: hookResult.externalUrl,
    notes: options.notes ?? (options.rollback ? `rollback to ${ref ?? resolvedHash}` : undefined),
  })

  if (!hookResult.ok) {
    console.error(chalk.red(`deploy hook failed: ${hookResult.error}`))
    process.exit(1)
  }

  console.log(`${options.rollback ? 'Rolled back' : 'Deployed'} ${chalk.yellow(resolvedHash.slice(0, 7))} to ${chalk.cyan(environment)}.`)
  if (hookResult.externalUrl) console.log(chalk.dim(`  ${hookResult.externalUrl}`))
}

export async function rollbackCommand(target: string, options: DeployOptions = {}): Promise<void> {
  await deployCommand(undefined, target, { ...options, rollback: true })
}

function inferEnvironment(environmentOrRef: string | undefined, refArg: string | undefined): string {
  if (refArg) return environmentOrRef ?? 'production'
  if (environmentOrRef && ['production', 'preview', 'staging'].includes(environmentOrRef)) return environmentOrRef
  return 'production'
}

function inferRef(
  environmentOrRef: string | undefined,
  refArg: string | undefined,
  explicitEnv: string | undefined,
): string | undefined {
  if (refArg) return refArg
  if (explicitEnv) return environmentOrRef
  if (environmentOrRef && !['production', 'preview', 'staging'].includes(environmentOrRef)) return environmentOrRef
  return undefined
}

async function triggerHook(
  hookUrl: string,
  payload: unknown,
): Promise<{ ok: boolean; error?: string; externalDeploymentId?: string; externalUrl?: string }> {
  try {
    const res = await fetch(hookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = await res.json().catch(() => ({})) as Record<string, unknown>
    return {
      ok: res.ok,
      error: res.ok ? undefined : String(body.error ?? body.message ?? res.statusText),
      externalDeploymentId: stringField(body, 'id') ?? stringField(body, 'deploymentId'),
      externalUrl: stringField(body, 'url') ?? stringField(body, 'deploymentUrl'),
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

async function recordDeployment(
  repoRoot: string,
  deployment: {
    commitHash: string
    env: string
    status: string
    externalDeploymentId?: string
    externalUrl?: string
    notes?: string
  },
): Promise<void> {
  const creds = loadCredentials()
  const remote = getRemote(repoRoot)
  if (!creds || !remote) return

  await fetch(`${remote.apiUrl}/api/v1/repos/${remote.ownerId}/${remote.repoName}/deployments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${creds.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(deployment),
  }).catch(() => undefined)
}

function stringField(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key]
  return typeof value === 'string' ? value : undefined
}
