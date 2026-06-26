#!/usr/bin/env node

import { spawnSync } from 'node:child_process'

try {
  spawnSync('git', ['config', 'core.hooksPath', '.git-hooks'], {
    stdio: 'ignore',
  })
} catch {
  // .git/config may not be writable (e.g. in CI or read-only checkout)
}
