import chalk from 'chalk'
import {
  assertSecureRemote,
  formatRemoteUrl,
  getRemote,
  setRemoteUrl,
} from '../lib/remote.js'
import { requireRepoRoot } from '../lib/repo.js'

export async function remoteCommand(args: string[]): Promise<void> {
  const repoRoot = requireRepoRoot()
  const [subcommand, value] = args

  if (subcommand === 'set') {
    if (!value) {
      console.error(chalk.red('usage: rekurn remote set <url>'))
      process.exit(1)
    }

    try {
      const remote = setRemoteUrl(repoRoot, value)
      console.log(`Remote set to ${chalk.cyan(formatRemoteUrl(remote.apiUrl, remote.ownerId, remote.repoName))}`)
      return
    } catch (err) {
      console.error(chalk.red(`error: ${err instanceof Error ? err.message : String(err)}`))
      process.exit(1)
    }
  }

  if (subcommand === 'show' || !subcommand) {
    const remote = getRemote(repoRoot)
    if (!remote) {
      console.log(chalk.dim('No remote configured.'))
      console.log(chalk.dim('  Run: rekurn remote set https://host/<ownerId>/<repoName>'))
      return
    }
    try {
      assertSecureRemote(remote, {
        allowInsecureLocalhost: process.env.REKURN_ALLOW_INSECURE_REMOTE === '1',
      })
    } catch (err) {
      console.log(chalk.red(`Remote is insecure: ${err instanceof Error ? err.message : String(err)}`))
    }
    console.log(formatRemoteUrl(remote.apiUrl, remote.ownerId, remote.repoName))
    return
  }

  console.error(chalk.red(`unknown remote command '${subcommand}'`))
  console.error(chalk.dim('  Usage: rekurn remote set <url>'))
  console.error(chalk.dim('         rekurn remote show'))
  process.exit(1)
}
