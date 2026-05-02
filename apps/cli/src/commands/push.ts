/**
 * rekurn push [remote] [branch]
 *
 * Pushes the current branch to the remote repository.
 *
 * Flow:
 *   1. Require login + local repo.
 *   2. Determine branch and local HEAD hash.
 *   3. If no remote is configured, auto-create a remote repo and save the URL.
 *   4. Fetch remote refs to discover the current remote HEAD for this branch.
 *   5. Collect all objects reachable from local HEAD but not from remote HEAD.
 *   6. Want/have negotiation → upload only missing objects.
 *   7. Update the remote ref (CAS).
 *   8. Write local remote-tracking ref.
 */

import chalk from 'chalk'
import { basename } from 'node:path'
import { loadCredentials } from '../lib/credentials.js'
import {
  requireRepoRoot,
  currentBranch,
  resolveHEAD,
  readObjectFromCache,
  writeRef,
} from '../lib/repo.js'
import { getRemote, setRemote, formatRemoteUrl } from '../lib/remote.js'
import {
  getRemoteRefs,
  collectObjectsForPush,
  getMissingFromRemote,
  uploadObject,
  updateRemoteRef,
} from '../lib/transfer.js'

export async function pushCommand(
  _remoteName?: string,
  branchName?: string,
): Promise<void> {
  const repoRoot = requireRepoRoot()
  const creds = loadCredentials()

  if (!creds) {
    console.error(chalk.red('Not logged in. Run "rekurn login" first.'))
    process.exit(1)
  }

  const branch = branchName ?? currentBranch(repoRoot) ?? 'main'
  const localHash = resolveHEAD(repoRoot)

  if (!localHash) {
    console.error(chalk.red('Nothing to push (no commits yet).'))
    process.exit(1)
  }

  // ----- Ensure remote is configured -----
  let remote = getRemote(repoRoot)

  if (!remote) {
    if (!creds.userId) {
      console.error(
        chalk.red('User ID not found in credentials. Please re-run "rekurn login".'),
      )
      process.exit(1)
    }

    // Auto-create repo on server using the local directory name
    const repoName = basename(repoRoot)
    const createRes = await fetch(`${creds.apiUrl}/api/v1/repos`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: repoName, visibility: 'private' }),
    })

    if (!createRes.ok && createRes.status !== 409) {
      const err = await createRes.json().catch(() => ({ error: 'Unknown error' })) as { error: string }
      console.error(chalk.red('Failed to create remote repo:'), err.error)
      process.exit(1)
    }

    setRemote(repoRoot, creds.apiUrl, creds.userId, repoName)
    remote = { apiUrl: creds.apiUrl, ownerId: creds.userId, repoName }

    const repoUrl = formatRemoteUrl(creds.apiUrl, creds.userId, repoName)
    console.log(chalk.green(`Created remote repository: ${repoUrl}`))
  }

  // ----- Get current remote hash for this branch -----
  const remoteRefs = await getRemoteRefs(remote, creds.token)
  const remoteRef = remoteRefs.find((r) => r.name === `heads/${branch}`)
  const remoteHash: string | null = remoteRef?.commitHash ?? null

  if (remoteHash === localHash) {
    console.log(chalk.dim('Everything up to date.'))
    return
  }

  // ----- Collect objects to push -----
  process.stdout.write('Collecting objects... ')
  const allHashes = collectObjectsForPush(repoRoot, localHash, remoteHash)
  console.log(chalk.dim(`${allHashes.size} objects`))

  // ----- Want/have negotiation -----
  process.stdout.write('Negotiating with remote... ')
  const missing = await getMissingFromRemote(remote, creds.token, [...allHashes])
  console.log(chalk.dim(`${missing.length} to upload`))

  // ----- Upload missing objects -----
  if (missing.length > 0) {
    let uploaded = 0
    for (const hash of missing) {
      const bytes = readObjectFromCache(repoRoot, hash)
      if (!bytes) {
        console.warn(chalk.yellow(`  warn: ${hash.slice(0, 12)}… not in local cache, skipping`))
        continue
      }
      await uploadObject(remote, creds.token, hash, bytes)
      uploaded++
      process.stdout.write(`\rWriting objects: ${uploaded}/${missing.length}`)
    }
    console.log()
  }

  // ----- Update remote ref (CAS) -----
  await updateRemoteRef(remote, creds.token, `heads/${branch}`, localHash, remoteHash)

  // ----- Update local tracking ref -----
  writeRef(repoRoot, `refs/remotes/origin/${branch}`, localHash)

  const arrow = remoteHash
    ? `${remoteHash.slice(0, 7)}..${localHash.slice(0, 7)}`
    : localHash.slice(0, 7)
  console.log(chalk.green(`\nTo ${formatRemoteUrl(remote.apiUrl, remote.ownerId, remote.repoName)}`))
  console.log(`  ${branch} -> ${branch}  (${arrow})`)
}
