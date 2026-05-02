/**
 * rekurn username [handle]
 *
 * Without an argument: shows the current user's username (if set).
 * With an argument: sets the username for your account on the remote.
 *
 * The username becomes your "owner slug" in repo URLs:
 *   https://<host>/<username>/<repo>
 *
 * Rules (enforced server-side):
 *   - 1–39 characters
 *   - lowercase letters, digits, hyphens only
 *   - cannot start or end with a hyphen
 *   - globally unique
 */

import chalk from 'chalk'
import { loadCredentials } from '../lib/credentials.js'
import { apiGet, apiPut } from '../lib/http.js'

export async function usernameCommand(handle?: string): Promise<void> {
  const creds = loadCredentials()
  if (!creds) {
    console.error(chalk.red('Not logged in. Run: rekurn login'))
    process.exit(1)
  }

  if (!handle) {
    // Show current username
    const res = await apiGet('/api/v1/users/me')
    if (!res.ok) {
      console.error(chalk.red(`Failed to fetch profile: ${res.status}`))
      process.exit(1)
    }
    const data = (await res.json()) as { username?: string | null; name?: string }
    if (data.username) {
      console.log(chalk.cyan(data.username))
    } else {
      console.log(chalk.yellow('No username set.'))
      console.log(`Run ${chalk.bold('rekurn username <handle>')} to set one.`)
    }
    return
  }

  // Set username
  const res = await apiPut('/api/v1/users/me', { username: handle })
  const data = (await res.json()) as { ok?: boolean; error?: string; username?: string }

  if (!res.ok) {
    console.error(chalk.red(data.error ?? `Server error ${res.status}`))
    process.exit(1)
  }

  console.log(chalk.green(`Username set: ${chalk.bold(data.username)}`))
  console.log(`Your repos are now accessible as: <host>/${chalk.bold(data.username)}/<repo>`)
}
