import chalk from 'chalk'

export async function rebaseCommand(): Promise<void> {
  console.error(chalk.yellow('rekurn rebase is not implemented yet.'))
  console.error(chalk.dim('  Phase 5 ships merge first; rebase needs commit replay and rewriting.'))
  process.exit(1)
}
