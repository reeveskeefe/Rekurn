import { existsSync, rmSync } from 'fs'
import { join } from 'path'
import chalk from 'chalk'
import {
  requireRepoRoot,
  readRef,
  writeRef,
  resolveHEAD,
  currentBranch,
  listBranches,
  rekurnDir,
  isImmutableRef,
  removeRefMetadata,
  readRefMetadata,
  listTags,
} from '../lib/repo.js'

export interface BranchOptions {
  /** Delete the named branch. */
  delete?: string
}

export async function branchCommand(
  name: string | undefined,
  options: BranchOptions,
): Promise<void> {
  const repoRoot = requireRepoRoot()

  // -------------------------------------------------------------------------
  // rekurn branch -d <name>  — delete a branch
  // -------------------------------------------------------------------------
  if (options.delete) {
    const target = options.delete
    const cur = currentBranch(repoRoot)

    if (cur === target) {
      console.error(chalk.red(`error: Cannot delete '${target}': it is your current branch.`))
      console.error(chalk.dim('  Switch to another branch first: rekurn return <other-branch>'))
      process.exit(1)
    }

    const refPath = join(rekurnDir(repoRoot), 'refs', 'heads', target)
    const refName = `refs/heads/${target}`
    if (!existsSync(refPath)) {
      console.error(chalk.red(`error: branch '${target}' not found`))
      process.exit(1)
    }

    if (isImmutableRef(repoRoot, refName)) {
      console.error(chalk.red(`error: branch '${target}' is immutable and cannot be deleted`))
      process.exit(1)
    }

    const hash = readRef(repoRoot, refName) ?? ''
    rmSync(refPath)
    removeRefMetadata(repoRoot, refName)
    console.log(
      `Deleted branch ${chalk.cyan(target)} (was ${chalk.yellow(hash.slice(0, 7))}).`,
    )
    return
  }

  // -------------------------------------------------------------------------
  // rekurn branch <name>  — create a new branch at current HEAD
  // -------------------------------------------------------------------------
  if (name) {
    if (!isValidBranchName(name)) {
      console.error(chalk.red(`error: '${name}' is not a valid branch name`))
      console.error(chalk.dim('  Branch names may contain letters, digits, hyphens, dots, and slashes.'))
      process.exit(1)
    }

    const existing = readRef(repoRoot, `refs/heads/${name}`)
    if (existing) {
      console.error(chalk.red(`fatal: A branch named '${name}' already exists.`))
      console.error(chalk.dim(`  To switch to it: rekurn return ${name}`))
      process.exit(1)
    }

    const headHash = resolveHEAD(repoRoot)
    if (!headHash) {
      console.error(chalk.red('fatal: Cannot create branch — no commits yet.'))
      process.exit(1)
    }

    writeRef(repoRoot, `refs/heads/${name}`, headHash)
    console.log(
      `Branch ${chalk.cyan(name)} created at ${chalk.yellow(headHash.slice(0, 7))}.`,
    )
    console.log(chalk.dim(`  Switch to it with: rekurn return ${name}`))
    return
  }

  // -------------------------------------------------------------------------
  // rekurn branch  — list all branches
  // -------------------------------------------------------------------------
  const branches = listBranches(repoRoot)
  const tags = listTags(repoRoot)
  const cur = currentBranch(repoRoot)
  const meta = readRefMetadata(repoRoot)

  if (branches.length === 0 && tags.length === 0) {
    console.log(chalk.dim('No branches yet. Make your first commit to create one.'))
    return
  }

  for (const branch of branches) {
    const hash = readRef(repoRoot, `refs/heads/${branch}`) ?? ''
    const shortHash = chalk.dim(`[${hash.slice(0, 7)}]`)
    const immutable = meta[`refs/heads/${branch}`]?.isImmutable ? chalk.magenta(' immutable') : ''

    if (branch === cur) {
      console.log(`${chalk.green('*')} ${chalk.bold.cyan(branch)} ${shortHash}${immutable}`)
    } else {
      console.log(`  ${branch} ${shortHash}${immutable}`)
    }
  }

  for (const tag of tags) {
    const hash = readRef(repoRoot, `refs/tags/${tag}`) ?? ''
    const immutable = meta[`refs/tags/${tag}`]?.isImmutable ? chalk.magenta(' immutable snapshot') : ' tag'
    console.log(`  ${chalk.cyan(`@${tag}`)} ${chalk.dim(`[${hash.slice(0, 7)}]`)}${immutable}`)
  }
}

// ---------------------------------------------------------------------------
// Branch name validation
// ---------------------------------------------------------------------------

function isValidBranchName(name: string): boolean {
  return (
    /^[a-zA-Z0-9_][a-zA-Z0-9_./-]*$/.test(name) &&
    !name.includes('..') &&
    !name.endsWith('/')
  )
}
