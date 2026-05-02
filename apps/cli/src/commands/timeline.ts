import chalk from 'chalk'
import { currentBranch, listBranches, listTags, readCommitFromCache, readRef, requireRepoRoot, resolveHEAD } from '../lib/repo.js'

export async function timelineCommand(): Promise<void> {
  const repoRoot = requireRepoRoot()
  const head = resolveHEAD(repoRoot)
  if (!head) {
    console.log(chalk.dim('No commits yet.'))
    return
  }

  const decorations = buildDecorations(repoRoot, head)
  const seen = new Set<string>()
  const queue = [head]

  while (queue.length > 0) {
    const hash = queue.shift()!
    if (seen.has(hash)) continue
    seen.add(hash)

    const commit = readCommitFromCache(repoRoot, hash)
    if (!commit) {
      console.log(`* ${chalk.red(hash.slice(0, 7))} missing`)
      continue
    }

    const firstLine = commit.message.split('\n')[0] ?? ''
    const refs = decorations.get(hash)
    const refText = refs && refs.length > 0 ? chalk.dim(` (${refs.join(', ')})`) : ''
    const merge = commit.parentHashes.length > 1 ? chalk.magenta(' merge') : ''
    console.log(`* ${chalk.yellow(hash.slice(0, 7))}${refText}${merge} ${firstLine}`)

    for (const parent of commit.parentHashes) {
      console.log(`|\\ ${chalk.dim(parent.slice(0, 7))}`)
      queue.push(parent)
    }
  }
}

function buildDecorations(repoRoot: string, head: string): Map<string, string[]> {
  const map = new Map<string, string[]>()
  const add = (hash: string, label: string) => {
    const labels = map.get(hash) ?? []
    labels.push(label)
    map.set(hash, labels)
  }

  add(head, 'HEAD')
  const cur = currentBranch(repoRoot)
  for (const branch of listBranches(repoRoot)) {
    const hash = readRef(repoRoot, `refs/heads/${branch}`)
    if (hash) add(hash, branch === cur ? `${branch}*` : branch)
  }
  for (const tag of listTags(repoRoot)) {
    const hash = readRef(repoRoot, `refs/tags/${tag}`)
    if (hash) add(hash, `@${tag}`)
  }
  return map
}
