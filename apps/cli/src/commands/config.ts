import chalk from 'chalk'
import { loadCredentials } from '../lib/credentials.js'
import { getRemote } from '../lib/remote.js'
import {
  readConfig,
  requireRepoRoot,
  writeLocalConfig,
} from '../lib/repo.js'

export async function configCommand(args: string[]): Promise<void> {
  const repoRoot = requireRepoRoot()
  const [subcommand, key, value] = args

  if (subcommand === 'deploy-hook') {
    if (!key || !value) {
      console.error(chalk.red('usage: rekurn config deploy-hook <environment> <url>'))
      process.exit(1)
    }

    try {
      new URL(value)
    } catch {
      console.error(chalk.red(`error: '${value}' is not a valid URL`))
      process.exit(1)
    }

    const config = readConfig(repoRoot)
    const deployHooks = { ...(config.deployHooks ?? {}), [key]: value }
    writeLocalConfig(repoRoot, { ...config, deployHooks })
    await syncDeployHooks(repoRoot, deployHooks)
    console.log(`Deploy hook for ${chalk.cyan(key)} set.`)
    return
  }

  if (subcommand === 'list' || !subcommand) {
    const config = readConfig(repoRoot)
    const hooks = config.deployHooks ?? {}
    if (Object.keys(hooks).length === 0) {
      console.log(chalk.dim('No deploy hooks configured.'))
    } else {
      for (const [env, url] of Object.entries(hooks)) {
        console.log(`deploy-hook.${env} ${chalk.dim(url)}`)
      }
    }
    return
  }

  console.error(chalk.red(`unknown config command '${subcommand}'`))
  process.exit(1)
}

async function syncDeployHooks(
  repoRoot: string,
  deployHooks: Record<string, string>,
): Promise<void> {
  const creds = loadCredentials()
  const remote = getRemote(repoRoot)
  if (!creds || !remote) return

  const res = await fetch(`${remote.apiUrl}/api/v1/repos/${remote.ownerId}/${remote.repoName}/deploy-hooks`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${creds.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ deployHooks }),
  })

  if (!res.ok) {
    console.warn(chalk.yellow('warning: deploy hook saved locally but remote sync failed'))
  }
}
