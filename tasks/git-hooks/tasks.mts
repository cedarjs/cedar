import { spawnSync } from 'node:child_process'
import path, { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { execAsync, isOnReleaseBranch } from './utils.mts'

const __dirname = dirname(fileURLToPath(import.meta.url))

const monorepoRoot = path.join(__dirname, '..', '..')

function isExcluded(file: string): boolean {
  // __fixtures__ at any depth (covers __fixtures__/* and **/__fixtures__/**)
  if (file.startsWith('__fixtures__/') || file.includes('/__fixtures__/')) {
    return true
  }

  // __snapshots__ at any depth
  if (file.startsWith('__snapshots__/') || file.includes('/__snapshots__/')) {
    return true
  }

  // .tsx files under any templates/ directory
  if (file.includes('/templates/') && file.endsWith('.tsx')) {
    return true
  }

  return false
}

function getStagedFiles() {
  const { stdout } = spawnSync(
    'git',
    ['diff', '--cached', '--name-only', '--diff-filter=ACMR'],
    { encoding: 'utf-8' },
  )

  return stdout.trim().split('\n').filter(Boolean)
}

function getBranchChangedFiles() {
  // Try to diff against main. If main doesn't exist locally, fetch it.
  let result = spawnSync(
    'git',
    ['diff', 'main...HEAD', '--name-only', '--diff-filter=ACMR'],
    { encoding: 'utf-8' },
  )

  // If diff failed (e.g., no local main ref), try fetching from a remote
  if (result.status !== 0) {
    // Try upstream first, then origin, then any available remote
    const remotes = ['upstream', 'origin']
    let fetchSucceeded = false

    for (const remote of remotes) {
      const fetchResult = spawnSync('git', ['fetch', remote, 'main:main'], {
        encoding: 'utf-8',
        stdio: 'pipe',
      })
      if (fetchResult.status === 0) {
        fetchSucceeded = true
        break
      }
    }

    if (!fetchSucceeded) {
      throw new Error(
        'Could not fetch main from any remote (tried upstream, origin). ' +
          'Ensure the main branch is available from at least one remote.',
      )
    }

    // Retry the diff
    result = spawnSync(
      'git',
      ['diff', 'main...HEAD', '--name-only', '--diff-filter=ACMR'],
      { encoding: 'utf-8' },
    )
    if (result.status !== 0) {
      throw new Error(
        `Failed to diff against main after fetching: ${result.stderr || result.stdout}`,
      )
    }
  }

  return result.stdout.trim().split('\n').filter(Boolean)
}

function getFilesToLint(files: string[]): string[] {
  const lintExts = new Set(['.js', '.ts', '.jsx', '.tsx', '.cjs', '.mjs'])

  return files.filter((file) => {
    return lintExts.has(path.extname(file)) && !isExcluded(file)
  })
}

function getFilesToFormat(files: string[]) {
  const formatExts = new Set([
    '.js',
    '.mjs',
    '.cjs',
    '.ts',
    '.mts',
    '.jsx',
    '.tsx',
    '.json',
    '.yml',
    '.md',
    '.mdx',
    '.css',
    '.sh',
  ])
  const formatExactNames = new Set([
    'Dockerfile',
    '.gitignore',
    '.gitattributes',
  ])

  return files.filter((file) => {
    if (formatExactNames.has(path.basename(file))) {
      return !isExcluded(file)
    }

    return formatExts.has(path.extname(file)) && !isExcluded(file)
  })
}

function runEslint(lintFiles: string[]) {
  return execAsync('yarn', ['eslint', ...lintFiles], 'git-hooks', {
    env: { CEDAR_CWD: 'packages/create-cedar-app/templates/ts' },
  })
}

function hasTemplateChanges(files: string[]): boolean {
  return files.some((f) => f.includes('packages/create-cedar-app/templates/'))
}

function hasCrwrsaChanges(files: string[]): boolean {
  return files.some((f) => f.includes('packages/create-cedar-rsc-app/'))
}

async function runAllLint(changedFiles: string[]): Promise<void> {
  // Check for template/crwrsca changes on the original file list before filtering,
  // since getFilesToLint() excludes template .tsx files
  const hasTemplates = hasTemplateChanges(changedFiles)
  const hasCrwrsa = hasCrwrsaChanges(changedFiles)

  const filesToLint = getFilesToLint(changedFiles)

  // Template and crwrsca packages have package-specific ESLint configs
  // that the root config ignores, so run their dedicated lint commands

  const otherFiles = filesToLint.filter(
    (f) =>
      !f.includes('packages/create-cedar-app/templates/') &&
      !f.includes('packages/create-cedar-rsc-app/'),
  )

  const lintTasks = []

  if (otherFiles.length > 0) {
    lintTasks.push(runEslint(otherFiles))
  }

  if (hasTemplates) {
    lintTasks.push(execAsync('yarn', ['lint:templates'], 'git-hooks'))
  }

  if (hasCrwrsa) {
    lintTasks.push(execAsync('yarn', ['lint:crwrsca'], 'git-hooks'))
  }

  const results = await Promise.allSettled(lintTasks)
  for (const r of results) {
    if (r.status === 'rejected') {
      throw (r.reason as Error & { exitCode?: number }).exitCode ?? 1
    }
  }
}

function runSmartFormat(formatFiles: string[]) {
  // Resolve relative paths to absolute so they work regardless of cwd
  const absolutePaths = formatFiles.map((f) => path.resolve(process.cwd(), f))

  return execAsync(
    'node',
    [path.join(__dirname, 'smart-format.mts'), ...absolutePaths],
    'git-hooks',
    { cwd: monorepoRoot },
  )
}

export async function runPreCommitTasks(): Promise<number> {
  // Skip on release branches. We have other tooling for releasing
  if (isOnReleaseBranch()) {
    return 0
  }

  const stagedFiles = getStagedFiles()

  if (stagedFiles.length === 0) {
    return 0
  }

  const filesToLint = getFilesToLint(stagedFiles)
  const filesToFormat = getFilesToFormat(stagedFiles)

  const results = await Promise.allSettled([
    filesToLint.length > 0 ? runEslint(filesToLint) : Promise.resolve(),
    filesToFormat.length > 0
      ? runSmartFormat(filesToFormat)
      : Promise.resolve(),
  ])

  // Return the exit code of the first failure, or 0 for success
  for (const r of results) {
    if (r.status === 'rejected') {
      return (r.reason as Error & { exitCode?: number }).exitCode ?? 1
    }
  }
  return 0
}

export async function runPrePushTasks(): Promise<number> {
  // Skip on release branches. We have other tooling for releasing
  if (isOnReleaseBranch()) {
    return 0
  }

  const buildPromise = execAsync('yarn', ['build'], 'git-hooks', {
    env: { NX_TUI: 'false' },
  })

  // Lint only files changed in this branch vs main — avoids running ESLint
  // on all packages (which is memory-intensive and slow). This only looks at
  // committed changes (git diff main...HEAD), not the working tree, since
  // uncommitted files can't be pushed anyway. We still lint the whole branch
  // diff here (not just the current commit) as a final sweep: the pre-commit
  // hook only lints what's staged for each individual commit, and can be
  // skipped per-commit with --no-verify, so some committed changes may never
  // have been linted before reaching this point.
  // Still runs after build because the ESLint config for templates requires
  // dist output from packages like @cedarjs/babel-config.
  const branchFiles = getBranchChangedFiles()
  const lintPromise = buildPromise.then(() =>
    branchFiles.length > 0 ? runAllLint(branchFiles) : Promise.resolve(),
  )

  const results = await Promise.allSettled([
    buildPromise,
    lintPromise,
    execAsync('yarn', ['prettier', '--check', '.'], 'git-hooks'),
    execAsync('yarn', ['check'], 'git-hooks'),
    execAsync(
      'node',
      [path.join(__dirname, '..', 'check-no-only.mts')],
      'git-hooks',
    ),
  ])

  for (const r of results) {
    if (r.status === 'rejected') {
      return (r.reason as Error & { exitCode?: number }).exitCode ?? 1
    }
  }
  return 0
}
