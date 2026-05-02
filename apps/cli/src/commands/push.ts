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
import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { derivePublicKey, sign } from '@rekurn/crypto'
import { loadCredentials } from '../lib/credentials.js'
import {
  requireRepoRoot,
  currentBranch,
  resolveHEAD,
  writeRef,
  readConfig,
} from '../lib/repo.js'
import { assertSecureRemote, getRemote, setRemote, formatRemoteUrl } from '../lib/remote.js'
import {
  getRemoteRefs,
  collectObjectsForPush,
  getMissingFromRemote,
  uploadObjects,
  updateRemoteRef,
  type PushCertificate,
} from '../lib/transfer.js'

export async function pushCommand(
  _remoteName?: string,
  branchName?: string,
): Promise<void> {
  const repoRoot = requireRepoRoot()
  const creds = loadCredentials()
  const allowInsecureLocalhost = process.env.REKURN_ALLOW_INSECURE_REMOTE === '1'

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

    const apiRemote = { apiUrl: creds.apiUrl, ownerId: creds.userId, repoName: basename(repoRoot) }
    try {
      assertSecureRemote(apiRemote, { allowInsecureLocalhost })
    } catch (err) {
      console.error(chalk.red(`Refusing insecure remote: ${err instanceof Error ? err.message : String(err)}`))
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

  try {
    assertSecureRemote(remote, { allowInsecureLocalhost })
  } catch (err) {
    console.error(chalk.red(`Refusing insecure remote: ${err instanceof Error ? err.message : String(err)}`))
    console.error(chalk.dim('  Use HTTPS, or set REKURN_ALLOW_INSECURE_REMOTE=1 for localhost development only.'))
    process.exit(1)
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
    await uploadObjects(
      remote,
      creds.token,
      repoRoot,
      missing,
      (uploaded) => process.stdout.write(`\rWriting objects: ${uploaded}/${missing.length}`),
      (hash) => console.warn(chalk.yellow(`  warn: ${hash.slice(0, 12)}... not in local cache, skipping`)),
    )
    console.log()
  }

  // ----- Update remote ref (CAS) -----
  const refName = `heads/${branch}`
  let pushCertificate: PushCertificate | undefined
  try {
    pushCertificate = buildPushCertificate(repoRoot, refName, remoteHash, localHash, creds.email)
  } catch (err) {
    console.error(chalk.red(`Failed to create signed push certificate: ${err instanceof Error ? err.message : String(err)}`))
    process.exit(1)
  }
  await updateRemoteRef(remote, creds.token, refName, localHash, remoteHash, pushCertificate)

  // ----- Update local tracking ref -----
  writeRef(repoRoot, `refs/remotes/origin/${branch}`, localHash)

  const arrow = remoteHash
    ? `${remoteHash.slice(0, 7)}..${localHash.slice(0, 7)}`
    : localHash.slice(0, 7)
  console.log(chalk.green(`\nTo ${formatRemoteUrl(remote.apiUrl, remote.ownerId, remote.repoName)}`))
  console.log(`  ${branch} -> ${branch}  (${arrow})`)
  if (pushCertificate) console.log(chalk.dim('  signed push certificate attached'))
}

function buildPushCertificate(
  repoRoot: string,
  refName: string,
  oldHash: string | null,
  newHash: string,
  pusher: string,
): PushCertificate | undefined {
  const config = readConfig(repoRoot)
  if (!config.signingKey) return undefined

  let secretKey: string
  try {
    secretKey = readFileSync(config.signingKey, 'utf8').trim()
  } catch {
    throw new Error(`signing key not found: ${config.signingKey}`)
  }
  if (!/^[0-9a-f]{64}$/i.test(secretKey)) {
    throw new Error('signing key must be a 64-character Ed25519 secret key seed in hex')
  }
  const payload: PushCertificate['payload'] = {
    refName,
    oldHash,
    newHash,
    pusher,
    timestamp: Math.floor(Date.now() / 1000),
    nonce: randomBytes(16).toString('hex'),
  }
  const message = Buffer.from(canonicalJson(payload), 'utf8')
  return {
    payload,
    signature: sign(message, secretKey),
    publicKey: derivePublicKey(secretKey),
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const obj = value as Record<string, unknown>
  return `{${Object.keys(obj).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(obj[key])}`).join(',')}}`
}
