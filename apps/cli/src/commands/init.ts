import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import chalk from 'chalk'

const REKURN_DIR = '.rekurn'

const DIRS = [
  '',
  'refs/heads',
  'refs/remotes',
  'refs/tags',
  'objects/cache',
]

export async function initCommand(_options: { bare?: boolean }, cmd: { args: string[] }): Promise<void> {
  const targetDir = resolve(cmd.args[0] ?? process.cwd())
  const rekurnPath = join(targetDir, REKURN_DIR)

  if (existsSync(rekurnPath)) {
    console.log(`Reinitialized existing Rekurn repository in ${chalk.cyan(rekurnPath + '/')}`)
    return
  }

  for (const dir of DIRS) {
    mkdirSync(join(rekurnPath, dir), { recursive: true })
  }

  // HEAD — points to refs/heads/main before the first commit
  writeFileSync(join(rekurnPath, 'HEAD'), 'ref: refs/heads/main\n', 'utf8')

  // Empty staging index
  writeFileSync(join(rekurnPath, 'index'), '{}', 'utf8')

  // Empty local config
  writeFileSync(
    join(rekurnPath, 'config'),
    JSON.stringify({ core: { defaultBranch: 'main' } }, null, 2) + '\n',
    'utf8',
  )

  console.log(
    `Initialized empty Rekurn repository in ${chalk.cyan(rekurnPath + '/')}`,
  )
  console.log()
  console.log(`  Set your identity with:`)
  console.log(chalk.dim(`  rekurn config user.name "Your Name"`))
  console.log(chalk.dim(`  rekurn config user.email "you@example.com"`))
}
