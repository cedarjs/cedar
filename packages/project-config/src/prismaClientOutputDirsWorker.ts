import { parentPort } from 'node:worker_threads'

import { getPrismaClientOutputDirs } from './prisma.js'

// Worker entry for `getPrismaClientOutputDirsIsolated()`
parentPort?.postMessage(await getPrismaClientOutputDirs())
