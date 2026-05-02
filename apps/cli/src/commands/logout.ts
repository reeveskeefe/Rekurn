import chalk from 'chalk'
import { clearCredentials, loadCredentials } from '../lib/credentials.js'

export async function logoutCommand(): Promise<void> {
  const creds = loadCredentials()
  if (!creds) {
    console.log(chalk.yellow('Not currently logged in.'))
    return
  }

  clearCredentials()
  console.log(chalk.green(`Logged out (was signed in as ${creds.email})`))
}
