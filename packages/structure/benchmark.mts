import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'

import * as RWProjectJS from './src/model/RWProject.js'
import type { RWProject as RWProjectJST } from './src/model/RWProject.js'

// @ts-expect-error tsx makes me do this
const RWProject: typeof RWProjectJST = RWProjectJS.default.RWProject

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixturePath = path.resolve(__dirname, '../../__fixtures__/test-project')

const ITERATIONS = 10

async function benchmark() {
  console.log('CedarJS Structure Performance Benchmark')
  console.log('=======================================\n')
  console.log(`Implementation: ts-morph`)
  console.log(`Target Project: ${fixturePath}`)
  console.log(`Iterations: ${ITERATIONS}\n`)

  const stats = {
    initTime: 0,
    coldDiagnosticsTime: 0,
    warmDiagnosticsTime: 0,
    heapUsed: 0,
    diagnosticCount: 0,
  }

  for (let i = 0; i < ITERATIONS; i++) {
    // 1. Project Initialization (Shallow)
    const t0 = performance.now()
    const project = new RWProject({ projectRoot: fixturePath })
    const t1 = performance.now()
    stats.initTime += t1 - t0

    // 2. Full Project Build & Diagnostics (Cold)
    // This triggers the heavy lifting of ts-morph parsing all files
    const t2 = performance.now()
    const diagnosticsCold = await project.collectDiagnostics()
    const t3 = performance.now()
    stats.coldDiagnosticsTime += t3 - t2
    stats.diagnosticCount = diagnosticsCold.length // Should be same across iterations

    // 3. Cached Diagnostics (Warm)
    const t4 = performance.now()
    await project.collectDiagnostics()
    const t5 = performance.now()
    stats.warmDiagnosticsTime += t5 - t4

    // 4. Memory Usage
    // Note: This measures memory at the end of each iteration.
    // It might increase due to ts-morph's internal state.
    stats.heapUsed += process.memoryUsage().heapUsed / 1024 / 1024
  }

  const averages: Record<string, string> = {
    'Avg Init (ms)': (stats.initTime / ITERATIONS).toFixed(2),
    'Avg Cold Diagnostics (ms)': (
      stats.coldDiagnosticsTime / ITERATIONS
    ).toFixed(2),
    'Avg Warm Diagnostics (ms)': (
      stats.warmDiagnosticsTime / ITERATIONS
    ).toFixed(2),
    'Avg Heap Used (MB)': (stats.heapUsed / ITERATIONS).toFixed(2),
    'Diagnostic Count': stats.diagnosticCount.toString(),
  }

  // Print Results
  console.table(averages)

  console.log('\nBreakdown:')
  console.log('- Avg Init: Time to create the RWProject instance.')
  console.log(
    '- Avg Cold: Time to build the entire graph and run all diagnostics (first run per iteration).',
  )
  console.log('- Avg Warm: Time to run diagnostics when using internal cache.')
  console.log('- Avg Heap: Total heap memory used after building the project.')
}

benchmark().catch((err) => {
  console.error('Benchmark failed:', err)
  process.exit(1)
})
