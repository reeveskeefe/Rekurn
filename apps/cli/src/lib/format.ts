import chalk from 'chalk'

// ---------------------------------------------------------------------------
// Status symbols
// ---------------------------------------------------------------------------

export const sym = {
  ok: chalk.green('✓'),
  warn: chalk.yellow('⚠'),
  error: chalk.red('✗'),
  dot: chalk.dim('·'),
}

// ---------------------------------------------------------------------------
// Diff line coloring
// ---------------------------------------------------------------------------

/** Print a unified diff string with color. */
export function printDiff(diff: string): void {
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) {
      console.log(chalk.bold(line))
    } else if (line.startsWith('@@')) {
      console.log(chalk.cyan(line))
    } else if (line.startsWith('+')) {
      console.log(chalk.green(line))
    } else if (line.startsWith('-')) {
      console.log(chalk.red(line))
    } else if (line.startsWith('diff --rekurn')) {
      console.log(chalk.bold.yellow(line))
    } else {
      console.log(line)
    }
  }
}

// ---------------------------------------------------------------------------
// Commit log formatting
// ---------------------------------------------------------------------------

export interface CommitSummary {
  hash: string
  message: string
  authorName: string
  authorEmail: string
  timestamp: number
  parentHashes: string[]
}

export function formatCommitOneline(commit: CommitSummary, headRef: string | null): string {
  const shortHash = chalk.yellow(commit.hash.slice(0, 7))
  const decoration = commit.hash === headRef ? chalk.cyan(' (HEAD)') : ''
  const firstLine = commit.message.split('\n')[0] ?? ''
  return `${shortHash}${decoration} ${firstLine}`
}

export function formatCommitFull(commit: CommitSummary): string {
  const lines: string[] = [
    chalk.yellow(`commit ${commit.hash}`),
    chalk.dim(`Author: ${commit.authorName} <${commit.authorEmail}>`),
    chalk.dim(`Date:   ${formatDate(commit.timestamp)}`),
    '',
    `    ${commit.message.trimEnd().split('\n').join('\n    ')}`,
    '',
  ]
  return lines.join('\n')
}

function formatDate(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  })
}

// ---------------------------------------------------------------------------
// Status output
// ---------------------------------------------------------------------------

export function printStatus(
  branch: string | null,
  staged: StatusEntry[],
  unstaged: StatusEntry[],
  untracked: string[],
): void {
  if (branch) {
    console.log(`On branch ${chalk.bold.cyan(branch)}`)
  } else {
    console.log(chalk.yellow('HEAD detached'))
  }

  if (staged.length === 0 && unstaged.length === 0 && untracked.length === 0) {
    console.log('\nNothing to commit, working tree clean')
    return
  }

  if (staged.length > 0) {
    console.log('\nChanges staged for commit:')
    console.log(chalk.dim('  (use "rekurn unstage <file>..." to unstage)'))
    for (const entry of staged) {
      const label = entry.status === 'added'
        ? chalk.green('        new file:   ')
        : entry.status === 'deleted'
        ? chalk.red('        deleted:    ')
        : chalk.green('        modified:   ')
      console.log(label + chalk.green(entry.path))
    }
  }

  if (unstaged.length > 0) {
    console.log('\nChanges not staged for commit:')
    console.log(chalk.dim('  (use "rekurn add <file>..." to update what will be committed)'))
    for (const entry of unstaged) {
      const label = entry.status === 'deleted'
        ? chalk.red('        deleted:    ')
        : chalk.red('        modified:   ')
      console.log(label + chalk.red(entry.path))
    }
  }

  if (untracked.length > 0) {
    console.log('\nUntracked files:')
    console.log(chalk.dim('  (use "rekurn add <file>..." to include in what will be committed)'))
    for (const p of untracked) {
      console.log(chalk.dim('        ' + p))
    }
  }
}

export interface StatusEntry {
  path: string
  status: 'added' | 'modified' | 'deleted'
}
