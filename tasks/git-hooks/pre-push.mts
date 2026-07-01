#!/usr/bin/env node

import { runPrePushTasks } from './tasks.mts'

const ok = await runPrePushTasks()
process.exit(ok ? 0 : 1)
