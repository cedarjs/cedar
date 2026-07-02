#!/usr/bin/env node

import { runPrePushTasks } from './tasks.mts'

const exitCode = await runPrePushTasks()
process.exit(exitCode)
