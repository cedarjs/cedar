import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'

function execAsync(
  command: string,
  args: string[],
  extraEnv: Record<string, string> = {},
) {
  return new Promise<number>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env: { ...process.env, ...extraEnv },
    })
    child.on('exit', (code) => resolve(code ?? 1))
    child.on('error', reject)
  })
}

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

function isOnReleaseBranch(): boolean {
  const { stdout } = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    encoding: 'utf-8',
  })
  const currentBranch = stdout.trim()

  return currentBranch === 'next' || currentBranch.startsWith('release/')
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
  return execAsync('yarn', ['eslint', ...lintFiles], {
    CEDAR_CWD: 'packages/create-cedar-app/templates/ts',
  })
}

function runSmartFormat(formatFiles: string[]) {
  return execAsync('node', ['tasks/git-hooks/smart-format.mts', ...formatFiles])
}

export async function runPreCommitTasks(): Promise<boolean> {
  // Skip on release branches. We have other tooling for releasing
  if (isOnReleaseBranch()) {
    return true
  }

  const stagedFiles = getStagedFiles()

  if (stagedFiles.length === 0) {
    return true
  }

  const filesToLint = getFilesToLint(stagedFiles)
  const filesToFormat = getFilesToFormat(stagedFiles)

  const results = await Promise.allSettled([
    filesToLint.length > 0 ? runEslint(filesToLint) : Promise.resolve(0),
    filesToFormat.length > 0
      ? runSmartFormat(filesToFormat)
      : Promise.resolve(0),
  ])

  const failed = results.filter((r) => r.status === 'rejected' || r.value !== 0)
  return failed.length === 0
}

export async function runPrePushTasks(): Promise<boolean> {
  // Skip on release branches. We have other tooling for releasing
  if (isOnReleaseBranch()) {
    return true
  }

  const results = await Promise.allSettled([
    execAsync('yarn', ['build'], { NX_TUI: 'false' }),
    execAsync('yarn', ['lint']),
    execAsync('yarn', ['prettier', '--check', '.']),
    execAsync('yarn', ['check']),
    execAsync('node', ['tasks/check-no-only.mts']),
  ])

  const failed = results.filter((r) => r.status === 'rejected' || r.value !== 0)
  return failed.length === 0
}
