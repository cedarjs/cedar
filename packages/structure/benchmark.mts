import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'

import * as RWProjectJS from './src/model/RWProject.js'
import type { RWProject as RWProjectJST } from './src/model/RWProject.js'

// @ts-expect-error tsx makes me do this
const RWProject: typeof RWProjectJST = RWProjectJS.default.RWProject

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixturePath = path.resolve(__dirname, '../../__fixtures__/test-project')

const WARMUP_ITERATIONS = 2
const ITERATIONS = 10

// Enable manual GC if running with --expose-gc
const gc = global.gc

async function forceGC() {
  if (gc) {
    // Run GC multiple times to ensure everything is cleaned up
    gc()
    gc()
    // Small delay to let GC settle
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

function getMemoryMB() {
  return process.memoryUsage().heapUsed / 1024 / 1024
}

function calculateStats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance =
    values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
    values.length
  const stdDev = Math.sqrt(variance)

  return {
    mean,
    median: sorted[Math.floor(sorted.length / 2)],
    min: sorted[0],
    max: sorted[sorted.length - 1],
    stdDev,
    p95: sorted[Math.floor(sorted.length * 0.95)],
  }
}

async function benchmark() {
  console.log('CedarJS Structure Performance Benchmark')
  console.log('=======================================\n')
  console.log(`Implementation: ts-morph`)
  console.log(`Target Project: ${fixturePath}`)
  console.log(`Warmup Iterations: ${WARMUP_ITERATIONS}`)
  console.log(`Measurement Iterations: ${ITERATIONS}`)
  console.log(
    `GC Control: ${gc ? 'enabled' : 'disabled (run with --expose-gc for accurate memory stats)'}`,
  )
  console.log('')

  // Track individual measurements
  const initTimes: number[] = []
  const coldDiagnosticsTimes: number[] = []
  const warmDiagnosticsTimes: number[] = []
  const memoryDeltas: number[] = []
  let diagnosticCount = 0

  // Warmup phase (don't measure these)
  console.log('Warming up...')
  for (let i = 0; i < WARMUP_ITERATIONS; i++) {
    const project = new RWProject({ projectRoot: fixturePath })
    await project.collectDiagnostics()
    await project.collectDiagnostics() // Warm cache
  }
  forceGC()
  console.log('Warmup complete.\n')

  // Measurement phase
  console.log('Running measurements...')

  // Establish a stable baseline
  await forceGC()
  const baselineMemory = getMemoryMB()

  for (let i = 0; i < ITERATIONS; i++) {
    // Stabilize memory before measurement
    await forceGC()
    const memBefore = getMemoryMB()

    // 1. Project Initialization (Shallow)
    const t0 = performance.now()
    const project = new RWProject({ projectRoot: fixturePath })
    const t1 = performance.now()
    initTimes.push(t1 - t0)

    // 2. Full Project Build & Diagnostics (Cold)
    const t2 = performance.now()
    const diagnosticsCold = await project.collectDiagnostics()
    const t3 = performance.now()
    coldDiagnosticsTimes.push(t3 - t2)
    diagnosticCount = diagnosticsCold.length

    // 3. Cached Diagnostics (Warm)
    const t4 = performance.now()
    await project.collectDiagnostics()
    const t5 = performance.now()
    warmDiagnosticsTimes.push(t5 - t4)

    // 4. Memory Usage - measure peak before GC
    const memPeak = getMemoryMB()
    const memDelta = memPeak - memBefore

    // Only record positive deltas (actual allocations)
    // Negative values indicate GC interference
    if (memDelta > 0) {
      memoryDeltas.push(memDelta)
    }

    process.stdout.write('.')
  }
  console.log(' done!\n')

  // Calculate statistics
  const initStats = calculateStats(initTimes)
  const coldStats = calculateStats(coldDiagnosticsTimes)
  const warmStats = calculateStats(warmDiagnosticsTimes)
  const memStats = calculateStats(memoryDeltas)

  // Print Results
  console.log('=== Initialization ===')
  console.table({
    Mean: `${initStats.mean.toFixed(2)} ms`,
    Median: `${initStats.median.toFixed(2)} ms`,
    Min: `${initStats.min.toFixed(2)} ms`,
    Max: `${initStats.max.toFixed(2)} ms`,
    'Std Dev': `${initStats.stdDev.toFixed(2)} ms`,
    P95: `${initStats.p95.toFixed(2)} ms`,
  })

  console.log('\n=== Cold Diagnostics (First Run) ===')
  console.table({
    Mean: `${coldStats.mean.toFixed(2)} ms`,
    Median: `${coldStats.median.toFixed(2)} ms`,
    Min: `${coldStats.min.toFixed(2)} ms`,
    Max: `${coldStats.max.toFixed(2)} ms`,
    'Std Dev': `${coldStats.stdDev.toFixed(2)} ms`,
    P95: `${coldStats.p95.toFixed(2)} ms`,
  })

  console.log('\n=== Warm Diagnostics (Cached) ===')
  console.table({
    Mean: `${warmStats.mean.toFixed(2)} ms`,
    Median: `${warmStats.median.toFixed(2)} ms`,
    Min: `${warmStats.min.toFixed(2)} ms`,
    Max: `${warmStats.max.toFixed(2)} ms`,
    'Std Dev': `${warmStats.stdDev.toFixed(2)} ms`,
    P95: `${warmStats.p95.toFixed(2)} ms`,
  })

  console.log('\n=== Memory Usage (Peak per Iteration) ===')
  if (memoryDeltas.length > 0) {
    console.table({
      Mean: `${memStats.mean.toFixed(2)} MB`,
      Median: `${memStats.median.toFixed(2)} MB`,
      Min: `${memStats.min.toFixed(2)} MB`,
      Max: `${memStats.max.toFixed(2)} MB`,
      'Std Dev': `${memStats.stdDev.toFixed(2)} MB`,
      P95: `${memStats.p95.toFixed(2)} MB`,
      Samples: memoryDeltas.length.toString(),
    })
  } else {
    console.log('No valid memory measurements (run with --expose-gc)')
  }

  console.log('\n=== Summary ===')
  console.log(`Total Diagnostics Found: ${diagnosticCount}`)
  console.log(
    `Total Time per Cold Run: ${(initStats.mean + coldStats.mean).toFixed(2)} ms`,
  )
  console.log(
    `Speedup (Cold → Warm): ${(coldStats.mean / warmStats.mean).toFixed(1)}x`,
  )

  console.log('\n=== Notes ===')
  console.log('- Init: Time to create RWProject instance (lightweight)')
  console.log(
    '- Cold: Full AST parsing + diagnostics (most relevant for comparison)',
  )
  console.log('- Warm: Re-running diagnostics with ts-morph internal caching')
  console.log(
    '- Memory Peak: Heap allocated per iteration (negative deltas filtered out)',
  )
  console.log(
    '\n⚠️  For accurate memory stats, run with: node --expose-gc benchmark.mts',
  )
  if (!gc) {
    console.log(
      '   Memory measurements are unreliable without GC control enabled.',
    )
  }
}

benchmark().catch((err) => {
  console.error('Benchmark failed:', err)
  process.exit(1)
})
