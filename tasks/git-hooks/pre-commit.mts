#!/usr/bin/env node

import { spawnSync, spawn } from 'node:child_process'

const { stdout: branchStdout } = spawnSync(
  'git',
  ['rev-parse', '--abbrev-ref', 'HEAD'],
  { encoding: 'utf-8' },
)
const currentBranch = branchStdout.trim()

// Skip on branches that don't need hooks (same as lefthook config)
if (currentBranch === 'next' || currentBranch.startsWith('release/')) {
  process.exit(0)
}

const { stdout: stagedStdout } = spawnSync(
  'git',
  ['diff', '--cached', '--name-only', '--diff-filter=ACMR'],
  { encoding: 'utf-8' },
)
const stagedFiles = stagedStdout.trim().split('\n').filter(Boolean)

if (stagedFiles.length === 0) {
  process.exit(0)
}

// ---------------------------------------------------------------------------
// Exclusion helpers — replicates lefthook's exclude patterns
// ---------------------------------------------------------------------------

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

function ext(file: string): string {
  const dot = file.lastIndexOf('.')
  return dot === -1 ? '' : file.slice(dot)
}

// ---------------------------------------------------------------------------
// Filter staged files per job
// ---------------------------------------------------------------------------

const lintExts = new Set(['.js', '.ts', '.jsx', '.tsx', '.cjs', '.mjs'])
const lintFiles = stagedFiles.filter(
  (f) => lintExts.has(ext(f)) && !isExcluded(f),
)

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
const formatExactNames = new Set(['Dockerfile', '.gitignore', '.gitattributes'])
const formatFiles = stagedFiles.filter((f) => {
  if (formatExactNames.has(f)) {
    return !isExcluded(f)
  }

  return formatExts.has(ext(f)) && !isExcluded(f)
})

// ---------------------------------------------------------------------------
// Run jobs in parallel (matching lefthook's parallel: true)
// ---------------------------------------------------------------------------

function quoteFiles(files: string[]): string {
  return files.map((f) => `'${f.replace(/'/g, "'\\''")}'`).join(' ')
}

function execAsync(
  cmd: string,
  extraEnv: Record<string, string> = {},
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, [], {
      shell: true,
      stdio: 'inherit',
      env: { ...process.env, ...extraEnv },
    })
    child.on('exit', (code) => resolve(code ?? 1))
    child.on('error', reject)
  })
}

const results = await Promise.allSettled([
  lintFiles.length > 0
    ? execAsync(
        `yarn cross-env CEDAR_CWD=packages/create-cedar-app/templates/ts yarn eslint ${quoteFiles(lintFiles)}`,
      )
    : Promise.resolve(0),
  formatFiles.length > 0
    ? execAsync(`node tasks/smart-format.mts ${quoteFiles(formatFiles)}`)
    : Promise.resolve(0),
])

const failed = results.filter((r) => r.status === 'rejected' || r.value !== 0)
process.exit(failed.length > 0 ? 1 : 0)
