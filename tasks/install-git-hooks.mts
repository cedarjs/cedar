#!/usr/bin/env node

import { spawnSync } from 'node:child_process'

const result = spawnSync('git', ['config', 'core.hooksPath', '.git-hooks'], {
  stdio: 'ignore',
})

// Non-zero status means .git/config wasn't writable (CI, read-only checkout,
// etc.)
if (result.status !== 0) {
  process.exitCode = result.status ?? 1
}
