#!/usr/bin/env node

import { spawnSync } from 'node:child_process'

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

const results = await Promise.allSettled([
  execAsync('yarn', ['build'], { NX_TUI: 'false' }),
  execAsync('yarn', ['lint']),
  execAsync('yarn', ['prettier', '--check', '.']),
  execAsync('yarn', ['check']),
  execAsync('node', ['tasks/check-no-only.mts']),
])

const failed = results.filter((r) => r.status === 'rejected' || r.value !== 0)
process.exit(failed.length > 0 ? 1 : 0)
