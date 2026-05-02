import chalk from 'chalk'
import {
  requireRepoRoot,
  resolveHEAD,
  writeRef,
  setRefMetadata,
} from '../lib/repo.js'

export async function snapshotCommand(name: string): Promise<void> {
  const repoRoot = requireRepoRoot()
  const headHash = resolveHEAD(repoRoot)
  if (!headHash) {
    console.error(chalk.red('fatal: cannot snapshot an unborn branch'))
    process.exit(1)
  }

  if (!/^[a-zA-Z0-9_][a-zA-Z0-9_./-]*$/.test(name) || name.includes('..')) {
    console.error(chalk.red(`error: '${name}' is not a valid snapshot name`))
    process.exit(1)
  }

  const refName = `refs/tags/${name}`
  writeRef(repoRoot, refName, headHash)
  setRefMetadata(repoRoot, {
    name: refName,
    commitHash: headHash,
    type: 'tag',
    isImmutable: true,
  })

  console.log(`Snapshot ${chalk.cyan(`@${name}`)} created at ${chalk.yellow(headHash.slice(0, 7))}.`)
}
