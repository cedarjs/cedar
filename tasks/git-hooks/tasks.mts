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

  // `lint` (via `lint:templates`) needs several packages' compiled `dist/`
  // output to already exist — the templates' eslint config `require()`s
  // things like `@cedarjs/babel-config`'s dist. Running it at the same time
  // as `build` races build's writes and intermittently fails with "Cannot
  // find module" for a dist file build hasn't produced yet. Everything else
  // below only reads source files, so it can still run alongside `build`.
  const lintPromise = buildPromise.then(() =>
    execAsync('yarn', ['lint'], 'git-hooks'),
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
