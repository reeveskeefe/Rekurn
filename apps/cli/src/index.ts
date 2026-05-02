import { Command } from 'commander'
import { initCommand } from './commands/init.js'
import { addCommand } from './commands/add.js'
import { commitCommand } from './commands/commit.js'
import { statusCommand } from './commands/status.js'
import { logCommand } from './commands/log.js'
import { diffCommand } from './commands/diff.js'
import { returnCommand } from './commands/return.js'
import { loginCommand } from './commands/login.js'
import { logoutCommand } from './commands/logout.js'
import { branchCommand } from './commands/branch.js'
import { pushCommand } from './commands/push.js'
import { pullCommand } from './commands/pull.js'
import { fetchCommand } from './commands/fetch.js'
import { cloneCommand } from './commands/clone.js'
import { mergeCommand } from './commands/merge.js'
import { rebaseCommand } from './commands/rebase.js'

const program = new Command()

program
  .name('rekurn')
  .description('Rekurn — Return to any version instantly.')
  .version('0.1.0')

// ---------------------------------------------------------------------------
// rekurn init
// ---------------------------------------------------------------------------
program
  .command('init [directory]')
  .description('Initialize a new Rekurn repository')
  .action(async (_dir: string | undefined, _cmd) => {
    const args = _dir ? [_dir] : []
    await initCommand({}, { args })
  })

// ---------------------------------------------------------------------------
// rekurn add
// ---------------------------------------------------------------------------
program
  .command('add [paths...]')
  .description('Stage files for the next commit')
  .action(async (paths: string[]) => {
    const targets = paths.length === 0 ? ['.'] : paths
    await addCommand(targets)
  })

// ---------------------------------------------------------------------------
// rekurn commit
// ---------------------------------------------------------------------------
program
  .command('commit')
  .description('Record staged changes as a new commit')
  .option('-m, --message <message>', 'Commit message')
  .option('--amend', 'Amend the previous commit')
  .action(async (options: { message?: string; amend?: boolean }) => {
    await commitCommand(options)
  })

// ---------------------------------------------------------------------------
// rekurn status
// ---------------------------------------------------------------------------
program
  .command('status')
  .description('Show the working tree status')
  .action(async () => {
    await statusCommand()
  })

// ---------------------------------------------------------------------------
// rekurn log
// ---------------------------------------------------------------------------
program
  .command('log')
  .description('Show commit history')
  .option('--oneline', 'Each commit on a single line')
  .option('-n, --number <count>', 'Limit to last N commits')
  .action(async (options: { oneline?: boolean; number?: string }) => {
    await logCommand({
      oneline: options.oneline,
      n: options.number ? parseInt(options.number, 10) : undefined,
    })
  })

// ---------------------------------------------------------------------------
// rekurn diff
// ---------------------------------------------------------------------------
program
  .command('diff')
  .description('Show changes between working tree, index, and commits')
  .option('--staged', 'Show staged changes (index vs HEAD)')
  .action(async (options: { staged?: boolean }) => {
    await diffCommand({ staged: options.staged })
  })

// ---------------------------------------------------------------------------
// Stubs for Phase 2+ commands (informative error until implemented)
// ---------------------------------------------------------------------------

const stub = (name: string) =>
  program
    .command(name)
    .description(`[coming soon] ${name}`)
    .allowUnknownOption()
    .action(() => {
      console.error(`'rekurn ${name}' is not yet implemented in this version.`)
      console.error(`Follow https://oreulius.com/rekurn for updates.`)
      process.exit(1)
    })

// ---------------------------------------------------------------------------
// rekurn branch
// ---------------------------------------------------------------------------
program
  .command('branch [name]')
  .description('List, create, or delete branches')
  .option('-d, --delete <name>', 'Delete a branch')
  .action(async (name: string | undefined, options: { delete?: string }) => {
    await branchCommand(name, { delete: options.delete })
  })

stub('switch')

// ---------------------------------------------------------------------------
// rekurn merge
// ---------------------------------------------------------------------------
program
  .command('merge <branch>')
  .description('Merge another branch or commit into the current branch')
  .action(async (branch: string) => {
    await mergeCommand(branch)
  })

// ---------------------------------------------------------------------------
// rekurn rebase
// ---------------------------------------------------------------------------
program
  .command('rebase [target]')
  .description('[stub] Reapply commits on top of another branch')
  .action(async () => {
    await rebaseCommand()
  })

// ---------------------------------------------------------------------------
// rekurn push
// ---------------------------------------------------------------------------
program
  .command('push [remote] [branch]')
  .description('Push current branch to the remote repository')
  .action(async (remote?: string, branch?: string) => {
    await pushCommand(remote, branch)
  })

// ---------------------------------------------------------------------------
// rekurn pull
// ---------------------------------------------------------------------------
program
  .command('pull')
  .description('Fetch and fast-forward the current branch')
  .action(async () => {
    await pullCommand()
  })

// ---------------------------------------------------------------------------
// rekurn fetch
// ---------------------------------------------------------------------------
program
  .command('fetch')
  .description('Download objects and refs from the remote without merging')
  .action(async () => {
    await fetchCommand()
  })

// ---------------------------------------------------------------------------
// rekurn clone
// ---------------------------------------------------------------------------
program
  .command('clone <url> [directory]')
  .description('Clone a remote Rekurn repository into a new directory')
  .action(async (url: string, directory?: string) => {
    await cloneCommand(url, directory)
  })
stub('tag')
stub('stash')
// ---------------------------------------------------------------------------
// rekurn return
// ---------------------------------------------------------------------------
program
  .command('return [target]')
  .description('Switch branches or restore a previous commit')
  .option('-b, --new-branch <name>', 'Create a new branch and switch to it')
  .option('-f, --force', 'Discard local changes without confirmation')
  .action(async (
    target: string | undefined,
    options: { newBranch?: string; force?: boolean },
  ) => {
    await returnCommand(target, options)
  })

stub('snapshot')
stub('deploy')
stub('remix')
stub('timeline')
stub('verify')
stub('audit')
stub('env')
stub('pack')

// ---------------------------------------------------------------------------
// rekurn login
// ---------------------------------------------------------------------------
program
  .command('login')
  .description('Log in to Rekurn (opens browser for magic-link auth)')
  .action(async () => {
    await loginCommand()
  })

// ---------------------------------------------------------------------------
// rekurn logout
// ---------------------------------------------------------------------------
program
  .command('logout')
  .description('Log out and clear saved credentials')
  .action(async () => {
    await logoutCommand()
  })

stub('remote')
stub('config')

program.parseAsync(process.argv)
