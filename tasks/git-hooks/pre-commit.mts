#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { extname } from 'node:path'

import { execAsync } from './shared.mts'

const { stdout: branchStdout } = spawnSync(
  'git',
  ['rev-parse', '--abbrev-ref', 'HEAD'],
  { encoding: 'utf-8' },
)
const currentBranch = branchStdout.trim()

// Skip on release branches. We have other tooling for releasing
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

// ---------------------------------------------------------------------------
// Filter staged files per job
// ---------------------------------------------------------------------------

const lintExts = new Set(['.js', '.ts', '.jsx', '.tsx', '.cjs', '.mjs'])
const lintFiles = stagedFiles.filter(
  (f) => lintExts.has(extname(f)) && !isExcluded(f),
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

  return formatExts.has(extname(f)) && !isExcluded(f)
})

const results = await Promise.allSettled([
  lintFiles.length > 0
    ? execAsync('yarn', ['eslint', ...lintFiles], {
        CEDAR_CWD: 'packages/create-cedar-app/templates/ts',
      })
    : Promise.resolve(0),
  formatFiles.length > 0
    ? execAsync('node', ['tasks/smart-format.mts', ...formatFiles])
    : Promise.resolve(0),
])

const failed = results.filter((r) => r.status === 'rejected' || r.value !== 0)
process.exit(failed.length > 0 ? 1 : 0)
