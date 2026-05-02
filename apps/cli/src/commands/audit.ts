import chalk from 'chalk'
import { loadCredentials } from '../lib/credentials.js'
import { apiGet } from '../lib/http.js'
import { getRemote } from '../lib/remote.js'
import { requireRepoRoot } from '../lib/repo.js'

interface AuditRow {
  id: string
  action: string
  meta: unknown
  ip: string | null
  createdAt: string
  userId: string | null
}

export async function auditCommand(): Promise<void> {
  const repoRoot = requireRepoRoot()
  const creds = loadCredentials()
  const remote = getRemote(repoRoot)

  if (!creds || !remote) {
    console.error(chalk.red('audit requires login and a configured remote'))
    process.exit(1)
  }

  const res = await apiGet(`/api/v1/repos/${remote.ownerId}/${remote.repoName}/audit`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string }
    console.error(chalk.red('audit failed:'), err.error ?? res.statusText)
    process.exit(1)
  }

  const rows = await res.json() as AuditRow[]
  if (rows.length === 0) {
    console.log(chalk.dim('No audit events.'))
    return
  }

  for (const row of rows) {
    const when = new Date(row.createdAt).toLocaleString()
    const meta = row.meta ? chalk.dim(` ${JSON.stringify(row.meta)}`) : ''
    console.log(`${chalk.yellow(when)} ${chalk.cyan(row.action)} ${chalk.dim(row.userId ?? 'system')}${meta}`)
  }
}
