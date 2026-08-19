#!/usr/bin/env node

import { runPreCommitTasks } from './tasks.mts'

const exitCode = await runPreCommitTasks()
process.exit(exitCode)
