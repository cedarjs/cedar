#!/usr/bin/env node

import { runPreCommitTasks } from './tasks.mts'

const ok = await runPreCommitTasks()
process.exit(ok ? 0 : 1)
