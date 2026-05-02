/**
 * rekurn fetch
 *
 * Downloads all objects for all remote refs and updates remote-tracking refs.
 * Does NOT modify the working tree or local branch refs.
 *
 * Flow:
 *   1. Require login + local repo.
 *   2. Read remote URL from config.
 *   3. Fetch all remote refs.
 *   4. Download all reachable objects (BFS).
 *   5. Write .rekurn/refs/remotes/origin/<branch> tracking refs.
 */

import chalk from 'chalk'
import { loadCredentials } from '../lib/credentials.js'
import { requireRepoRoot, writeRef } from '../lib/repo.js'
import { getRemote } from '../lib/remote.js'
import { getRemoteRefs, fetchObjects } from '../lib/transfer.js'

export async function fetchCommand(): Promise<void> {
  const repoRoot = requireRepoRoot()
  const creds = loadCredentials()

  if (!creds) {
    console.error(chalk.red('Not logged in. Run "rekurn login" first.'))
    process.exit(1)
  }

  const remote = getRemote(repoRoot)
  if (!remote) {
    console.error(chalk.red('No remote configured. Use "rekurn push" to push and auto-configure a remote.'))
    process.exit(1)
  }

  console.log(chalk.dim(`From ${remote.apiUrl}/${remote.ownerId}/${remote.repoName}`))

  // ----- Get remote refs -----
  const remoteRefs = await getRemoteRefs(remote, creds.token)
  if (remoteRefs.length === 0) {
    console.log('No remote refs found.')
    return
  }

  // ----- Download all objects -----
  const commitHashes = remoteRefs.map((r) => r.commitHash)

  let downloaded = 0
  const total = await fetchObjects(
    remote,
    creds.token,
    repoRoot,
    commitHashes,
    (n) => {
      downloaded = n
      process.stdout.write(`\rReceiving objects: ${n}`)
    },
  )
  if (total > 0) console.log()

  // ----- Update remote-tracking refs -----
  for (const ref of remoteRefs) {
    // ref.name is like "heads/main"
    if (ref.name.startsWith('heads/')) {
      const branch = ref.name.slice('heads/'.length)
      writeRef(repoRoot, `refs/remotes/origin/${branch}`, ref.commitHash)
      console.log(
        chalk.dim(` * [new branch]    origin/${branch} -> ${ref.commitHash.slice(0, 7)}`),
      )
    }
  }

  if (downloaded === 0) {
    console.log('Already up to date.')
  }
}
