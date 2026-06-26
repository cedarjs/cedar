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

// ---------------------------------------------------------------------------
// Run jobs in parallel (matching lefthook's parallel: true)
// ---------------------------------------------------------------------------

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
  execAsync('yarn build', { NX_TUI: 'false' }),
  execAsync('yarn lint'),
  execAsync('yarn prettier --check .'),
  execAsync('yarn check'),
  execAsync('node tasks/check-no-only.mts'),
])

const failed = results.filter((r) => r.status === 'rejected' || r.value !== 0)
process.exit(failed.length > 0 ? 1 : 0)
