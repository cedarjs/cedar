#!/usr/bin/env node

/* eslint-env node */

/**
 * CI-friendly diagnostic script for debugging Windows timeout issues in createServer tests
 *
 * Usage:
 *   node scripts/diagnose-timeouts.mjs [iterations] [timeout-ms]
 *
 * Environment variables:
 *   CEDAR_DEBUG_TIMEOUT=1  - Enable detailed logging
 *   CI=true               - CI mode (affects output formatting)
 */

import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { setTimeout } from 'node:timers/promises'

// Configuration
const DEFAULT_ITERATIONS = process.env.CI ? 5 : 10
const DEFAULT_TIMEOUT_MS = 30000
const DELAY_BETWEEN_RUNS = process.env.CI ? 500 : 1000

// Parse arguments
const iterations = parseInt(process.argv[2]) || DEFAULT_ITERATIONS
const timeoutMs = parseInt(process.argv[3]) || DEFAULT_TIMEOUT_MS

// Enable diagnostic mode
process.env.NODE_ENV = 'test'
process.env.CEDAR_DEBUG_TIMEOUT = '1'

// Set up test environment like the actual test
const fixturesPath = new URL(
  '../src/__tests__/fixtures/graphql/cedar-app',
  import.meta.url,
).pathname
process.env.RWJS_CWD = fixturesPath

// Change to the fixture directory before importing
process.chdir(fixturesPath)

const isCI = process.env.CI === 'true'

// CI-friendly logging
function log(message, level = 'info') {
  const timestamp = new Date().toISOString()
  const prefix = isCI ? `::${level}::` : ''
  console.log(`${prefix}[${timestamp}] ${message}`)
}

function logError(message) {
  log(message, 'error')
}

function logWarning(message) {
  log(message, 'warning')
}

function logGroup(title, fn) {
  if (isCI) {
    console.log(`::group::${title}`)
    fn()
    console.log('::endgroup::')
  } else {
    console.log(`\n📋 ${title}`)
    console.log('='.repeat(title.length + 4))
    fn()
  }
}

// Initialize results tracking
const results = {
  successful: 0,
  timeouts: 0,
  errors: 0,
  times: [],
  details: [],
  systemInfo: {
    platform: process.platform,
    nodeVersion: process.version,
    isCI: isCI,
    timestamp: new Date().toISOString(),
  },
}

log(`Starting timeout diagnostics`)
log(`Platform: ${process.platform}, Node: ${process.version}`)
log(`Iterations: ${iterations}, Timeout: ${timeoutMs}ms`)
log(`Test fixture: ${fixturesPath}`)

// Import createServer after setting up the environment
const { createServer } = await import('../dist/createServer.js')

async function runSingleTest(iteration) {
  const startTime = performance.now()
  const label = `Test ${iteration + 1}/${iterations}`

  if (!isCI) {
    process.stdout.write(`${label}... `)
  }

  try {
    // Create a timeout promise
    const timeoutPromise = setTimeout(timeoutMs).then(() => {
      throw new Error(`TIMEOUT_${timeoutMs}`)
    })

    // Race between server creation and timeout
    const server = await Promise.race([createServer(), timeoutPromise])

    const duration = performance.now() - startTime

    // Clean up
    if (server && typeof server.close === 'function') {
      await server.close()
    }

    results.successful++
    results.times.push(duration)
    results.details.push({
      iteration: iteration + 1,
      status: 'success',
      duration,
      timestamp: new Date().toISOString(),
    })

    if (isCI) {
      log(`${label} SUCCESS (${duration.toFixed(2)}ms)`)
    } else {
      console.log(`✅ (${duration.toFixed(2)}ms)`)
    }

    return true
  } catch (error) {
    const duration = performance.now() - startTime

    if (error.message.includes('TIMEOUT_')) {
      results.timeouts++
      results.details.push({
        iteration: iteration + 1,
        status: 'timeout',
        duration,
        error: error.message,
        timestamp: new Date().toISOString(),
      })

      if (isCI) {
        logWarning(`${label} TIMEOUT after ${duration.toFixed(2)}ms`)
      } else {
        console.log(`⏰ TIMEOUT`)
      }
    } else {
      results.errors++
      results.details.push({
        iteration: iteration + 1,
        status: 'error',
        duration,
        error: error.message,
        stack: error.stack?.split('\n').slice(0, 5).join('\n'), // Truncate stack for CI
        timestamp: new Date().toISOString(),
      })

      if (isCI) {
        logError(`${label} ERROR: ${error.message}`)
      } else {
        console.log(`❌ ${error.message}`)
      }
    }

    return false
  }
}

async function runDiagnosticTests() {
  log(`Running ${iterations} diagnostic iterations...`)

  for (let i = 0; i < iterations; i++) {
    await runSingleTest(i)

    // Add delay between runs to avoid resource conflicts
    if (i < iterations - 1) {
      await setTimeout(DELAY_BETWEEN_RUNS)
    }
  }

  // Calculate statistics
  const totalTime = results.times.reduce((sum, time) => sum + time, 0)
  const avgTime =
    results.times.length > 0 ? totalTime / results.times.length : 0
  const minTime = results.times.length > 0 ? Math.min(...results.times) : 0
  const maxTime = results.times.length > 0 ? Math.max(...results.times) : 0
  const successRate = ((results.successful / iterations) * 100).toFixed(1)
  const timeoutRate = ((results.timeouts / iterations) * 100).toFixed(1)

  // Print summary
  logGroup('DIAGNOSTIC RESULTS', () => {
    log(`Total iterations: ${iterations}`)
    log(`Successful: ${results.successful} (${successRate}%)`)
    log(`Timeouts: ${results.timeouts} (${timeoutRate}%)`)
    log(
      `Errors: ${results.errors} (${((results.errors / iterations) * 100).toFixed(1)}%)`,
    )

    if (results.times.length > 0) {
      log(`Average time: ${avgTime.toFixed(2)}ms`)
      log(`Min time: ${minTime.toFixed(2)}ms`)
      log(`Max time: ${maxTime.toFixed(2)}ms`)
    }
  })

  // Analysis and recommendations
  if (results.timeouts > 0) {
    logGroup('TIMEOUT ANALYSIS', () => {
      logWarning(
        `Timeout rate: ${timeoutRate}% - This indicates a timing issue`,
      )

      if (process.platform === 'win32') {
        log('Windows-specific recommendations:')
        log('- Consider increasing hookTimeout in vitest.config.mts')
        log('- Check for antivirus interference')
        log('- Verify adequate system resources')
        log('- Consider retry logic for CI')
      }
    })
  }

  if (results.errors > 0) {
    logGroup('ERROR ANALYSIS', () => {
      results.details
        .filter((d) => d.status === 'error')
        .forEach((detail) => {
          logError(`Iteration ${detail.iteration}: ${detail.error}`)
        })
    })
  }

  // Save detailed results
  const reportData = {
    metadata: {
      ...results.systemInfo,
      iterations,
      timeoutMs,
      testCommand: process.argv.join(' '),
    },
    summary: {
      successful: results.successful,
      timeouts: results.timeouts,
      errors: results.errors,
      successRate: parseFloat(successRate),
      timeoutRate: parseFloat(timeoutRate),
      avgTime,
      minTime,
      maxTime,
    },
    details: results.details,
  }

  // Determine output file
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const filename = process.env.CI
    ? `timeout-diagnostic-report.json`
    : `timeout-diagnostic-${timestamp}.json`

  const reportPath = resolve(filename)

  try {
    await writeFile(reportPath, JSON.stringify(reportData, null, 2))
    log(`Diagnostic report saved: ${reportPath}`)

    // In CI, also output key metrics for GitHub Actions
    if (isCI) {
      console.log(`::set-output name=success_rate::${successRate}`)
      console.log(`::set-output name=timeout_rate::${timeoutRate}`)
      console.log(`::set-output name=avg_time::${avgTime.toFixed(2)}`)
      console.log(`::set-output name=report_file::${reportPath}`)
    }
  } catch (err) {
    logError(`Could not save diagnostic report: ${err.message}`)
  }

  // Final assessment
  if (results.timeouts > 0) {
    logWarning(
      `Detected ${results.timeouts} timeouts out of ${iterations} runs`,
    )
    if (isCI) {
      logWarning(
        'This confirms the intermittent timeout issue exists in this environment',
      )
    }
    return 1 // Exit code indicating timeouts detected
  } else if (results.errors > 0) {
    logError(`Detected ${results.errors} errors out of ${iterations} runs`)
    return 2 // Exit code indicating errors
  } else {
    log(
      `All ${iterations} tests completed successfully - no timeout issues detected`,
    )
    return 0 // Success
  }
}

// Error handling
process.on('SIGINT', () => {
  logWarning('Interrupted by user')
  process.exit(130)
})

process.on('uncaughtException', (error) => {
  logError(`Uncaught exception: ${error.message}`)
  if (!isCI) {
    console.error(error.stack)
  }
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  logError(`Unhandled rejection: ${reason}`)
  process.exit(1)
})

// Run the diagnostic tests
runDiagnosticTests()
  .then((exitCode) => process.exit(exitCode))
  .catch((error) => {
    logError(`Diagnostic script failed: ${error.message}`)
    if (!isCI) {
      console.error(error.stack)
    }
    process.exit(1)
  })
