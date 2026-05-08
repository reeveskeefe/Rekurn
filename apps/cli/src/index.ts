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
import { snapshotCommand } from './commands/snapshot.js'
import { timelineCommand } from './commands/timeline.js'
import { verifyCommand } from './commands/verify.js'
import { auditCommand } from './commands/audit.js'
import { configCommand } from './commands/config.js'
import { deployCommand, rollbackCommand } from './commands/deploy.js'
import { remoteCommand } from './commands/remote.js'
import { usernameCommand } from './commands/username.js'
import { settingsCommand } from './commands/settings.js'

if (process.env.INIT_CWD && process.env.INIT_CWD !== process.cwd()) {
  process.chdir(process.env.INIT_CWD)
}

const program = new Command()

program
  .name('rekurn')
  .description('Rekurn — Return to any version instantly.')
  .version('0.2.6')

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
      console.error(`Follow https://github.com/reeveskeefe/Rekurn for updates.`)
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
  .option('--public', 'Create the remote repository as public when it does not exist')
  .option('--private', 'Create the remote repository as private when it does not exist')
  .action(async (remote: string | undefined, branch: string | undefined, options: { public?: boolean; private?: boolean }) => {
    await pushCommand(remote, branch, {
      visibility: options.public ? 'public' : 'private',
    })
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
  .option('--preview', 'Preview the checkout without changing files')
  .option('--at <time>', 'Return to the first commit at or before a time, e.g. "2 days ago"')
  .option('--file <path>', 'Restore one file from the target commit')
  .action(async (
    target: string | undefined,
    options: { newBranch?: string; force?: boolean; preview?: boolean; at?: string; file?: string },
  ) => {
    await returnCommand(target, options)
  })

// ---------------------------------------------------------------------------
// rekurn snapshot
// ---------------------------------------------------------------------------
program
  .command('snapshot <name>')
  .description('Create an immutable snapshot tag at HEAD')
  .action(async (name: string) => {
    await snapshotCommand(name)
  })

// ---------------------------------------------------------------------------
// rekurn deploy
// ---------------------------------------------------------------------------
program
  .command('deploy [environmentOrRef] [ref]')
  .description('Trigger a configured deploy hook and record the release')
  .option('--env <environment>', 'Deployment environment')
  .option('--notes <notes>', 'Deployment notes')
  .action(async (
    environmentOrRef: string | undefined,
    ref: string | undefined,
    options: { env?: string; notes?: string },
  ) => {
    await deployCommand(environmentOrRef, ref, options)
  })

// ---------------------------------------------------------------------------
// rekurn rollback
// ---------------------------------------------------------------------------
program
  .command('rollback <target>')
  .description('Deploy a previous version again and record it as a rollback')
  .option('--env <environment>', 'Deployment environment')
  .option('--notes <notes>', 'Rollback notes')
  .action(async (target: string, options: { env?: string; notes?: string }) => {
    await rollbackCommand(target, options)
  })

stub('remix')

// ---------------------------------------------------------------------------
// rekurn timeline
// ---------------------------------------------------------------------------
program
  .command('timeline')
  .description('Show an ASCII graph of commits and branches')
  .action(async () => {
    await timelineCommand()
  })

// ---------------------------------------------------------------------------
// rekurn verify
// ---------------------------------------------------------------------------
program
  .command('verify')
  .description('Verify object hashes, commit chain, and signatures when possible')
  .action(async () => {
    await verifyCommand()
  })

// ---------------------------------------------------------------------------
// rekurn audit
// ---------------------------------------------------------------------------
program
  .command('audit')
  .description('Show remote audit log events')
  .action(async () => {
    await auditCommand()
  })
stub('env')
stub('pack')

// ---------------------------------------------------------------------------
// rekurn login
// ---------------------------------------------------------------------------
program
  .command('login [url]')
  .description('Log in to your Rekurn host (e.g. rekurn login https://api.your-site.com)')
  .action(async (url?: string) => {
    await loginCommand(url)
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

// ---------------------------------------------------------------------------
// rekurn remote
// ---------------------------------------------------------------------------
program
  .command('remote [args...]')
  .description('Show or configure the remote Rekurn API target')
  .action(async (args: string[]) => {
    await remoteCommand(args)
  })

// ---------------------------------------------------------------------------
// rekurn settings
// ---------------------------------------------------------------------------
program
  .command('settings')
  .description('Manage connected Rekurn sites — switch, view, or remove')
  .action(async () => {
    await settingsCommand()
  })

// ---------------------------------------------------------------------------
// rekurn username
// ---------------------------------------------------------------------------
program
  .command('username [handle]')
  .description('Show or set your username for pretty repo URLs: <host>/<username>/<repo>')
  .action(async (handle?: string) => {
    await usernameCommand(handle)
  })

// ---------------------------------------------------------------------------
// rekurn config
// ---------------------------------------------------------------------------
program
  .command('config [args...]')
  .description('Configure Rekurn repository settings')
  .action(async (args: string[]) => {
    await configCommand(args)
  })

program.parseAsync(process.argv)
