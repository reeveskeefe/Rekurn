/**
 * rekurn clone <url> [directory]
 *
 * Clone a remote Rekurn repository into a local directory.
 *
 * Flow:
 *   1. Parse the remote URL → { apiUrl, ownerId, repoName }.
 *   2. Create / enter the target directory.
 *   3. Initialise a new .rekurn/ structure.
 *   4. Record the remote URL in config.
 *   5. Fetch all refs + download all reachable objects.
 *   6. Checkout the default branch into the working tree.
 *   7. Write HEAD, branch ref, and index.
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import chalk from 'chalk'
import { parseCommit } from '@rekurn/core'
import { loadCredentials } from '../lib/credentials.js'
import {
  rekurnDir,
  writeHEAD,
  writeRef,
  readObjectFromCache,
  writeIndex,
  flattenTreeHash,
} from '../lib/repo.js'
import { parseRemoteUrl, setRemote } from '../lib/remote.js'
import { getRemoteRefs, fetchObjects } from '../lib/transfer.js'
import type { Index } from '@rekurn/types'

// ---------------------------------------------------------------------------
// Checkout helpers
// ---------------------------------------------------------------------------

function extractBlobContent(bytes: Buffer): Buffer {
  const afterPrefix = bytes.slice('rekurn-blob\n'.length)
  const nlIdx = afterPrefix.indexOf(0x0a)
  return afterPrefix.slice(nlIdx + 1)
}

function checkoutTree(
  repoRoot: string,
  treeHash: string,
): { index: Index; fileCount: number } {
  const files = flattenTreeHash(repoRoot, treeHash) ?? {}

  const index: Index = {}
  let fileCount = 0

  for (const [relPath, { hash, mode }] of Object.entries(files)) {
    const blobBytes = readObjectFromCache(repoRoot, hash)
    if (!blobBytes) continue
    const content = extractBlobContent(blobBytes)
    const fullPath = join(repoRoot, relPath)
    mkdirSync(dirname(fullPath), { recursive: true })
    writeFileSync(fullPath, content)
    index[relPath] = {
      hash,
      mode: mode === '100755' ? '100755' : '100644',
      size: content.length,
    }
    fileCount++
  }

  return { index, fileCount }
}

// ---------------------------------------------------------------------------
// Initialise a bare .rekurn/ skeleton
// ---------------------------------------------------------------------------

function initRepo(repoRoot: string): void {
  const rdir = rekurnDir(repoRoot)
  for (const sub of ['refs/heads', 'refs/tags', 'refs/remotes/origin', 'objects/cache']) {
    mkdirSync(join(rdir, sub), { recursive: true })
  }
  // HEAD initially points to main
  writeHEAD(repoRoot, { type: 'symbolic', ref: 'refs/heads/main' })
  writeFileSync(join(rdir, 'index'), JSON.stringify({}), 'utf-8')
}

// ---------------------------------------------------------------------------
// Clone command
// ---------------------------------------------------------------------------

export async function cloneCommand(remoteUrl: string, directory?: string): Promise<void> {
  const creds = loadCredentials()
  if (!creds) {
    console.error(chalk.red('Not logged in. Run "rekurn login" first.'))
    process.exit(1)
  }

  const info = parseRemoteUrl(remoteUrl)
  if (!info) {
    console.error(
      chalk.red(
        'Invalid remote URL. Expected format: https://<host>/<userId>/<repoName>',
      ),
    )
    process.exit(1)
  }

  // Determine target directory
  const targetDir = directory ?? info.repoName
  const repoRoot = join(process.cwd(), targetDir)

  if (existsSync(repoRoot)) {
    console.error(chalk.red(`Directory '${targetDir}' already exists.`))
    process.exit(1)
  }

  console.log(`Cloning into '${targetDir}'...`)

  // Create directory and initialise repo
  mkdirSync(repoRoot, { recursive: true })
  initRepo(repoRoot)
  setRemote(repoRoot, info.apiUrl, info.ownerId, info.repoName)

  // ----- Fetch remote refs -----
  const remoteRefs = await getRemoteRefs(info, creds.token)
  if (remoteRefs.length === 0) {
    console.log(chalk.yellow('Remote repository is empty.'))
    return
  }

  // Find default branch (prefer "heads/main", fallback to first branch ref)
  const branchRefs = remoteRefs.filter((r) => r.name.startsWith('heads/'))
  const defaultRef =
    branchRefs.find((r) => r.name === 'heads/main') ??
    branchRefs[0] ??
    remoteRefs[0]!

  const defaultBranch = defaultRef.name.startsWith('heads/')
    ? defaultRef.name.slice('heads/'.length)
    : 'main'

  // ----- Download all objects -----
  const commitHashes = remoteRefs.map((r) => r.commitHash)
  let fetched = 0

  await fetchObjects(info, creds.token, repoRoot, commitHashes, (n) => {
    fetched = n
    process.stdout.write(`\rReceiving objects: ${n}`)
  })
  if (fetched > 0) console.log()

  // ----- Write remote-tracking refs -----
  for (const ref of remoteRefs) {
    if (ref.name.startsWith('heads/')) {
      const branch = ref.name.slice('heads/'.length)
      writeRef(repoRoot, `refs/remotes/origin/${branch}`, ref.commitHash)
    }
  }

  // ----- Checkout default branch -----
  const headCommitHash = defaultRef.commitHash
  const commitBytes = readObjectFromCache(repoRoot, headCommitHash)

  if (!commitBytes) {
    console.error(chalk.red('Failed to read HEAD commit from local cache after fetch.'))
    process.exit(1)
  }

  const commit = parseCommit(commitBytes)
  const { index, fileCount } = checkoutTree(repoRoot, commit.treeHash)

  writeIndex(repoRoot, index)
  writeRef(repoRoot, `refs/heads/${defaultBranch}`, headCommitHash)
  writeHEAD(repoRoot, { type: 'symbolic', ref: `refs/heads/${defaultBranch}` })

  console.log(chalk.green(`\nCheckout ${fileCount} file(s). Branch: ${defaultBranch}`))
}
