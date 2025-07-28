#!/usr/bin/env node
/* eslint-env node, es6*/

import os from 'node:os'
import path from 'node:path'
import url from 'node:url'

import ansis from 'ansis'
import type { ExecaChildProcess } from 'execa'
import execa from 'execa'
import fg from 'fast-glob'
import fs from 'fs-extra'
import { hideBin } from 'yargs/helpers'
import yargs from 'yargs/yargs'

import {
  buildRedwoodFramework,
  addFrameworkDepsToProject,
  cleanUp,
  copyFrameworkPackages,
  createRedwoodJSApp,
  initGit,
  runYarnInstall,
} from './util/util.mjs'

// useful consts
const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

// Utility function to find bin path from package.json
function findBinPath(appPath: string, packageName: string, binName: string) {
  try {
    const packageJsonPath = path.join(
      appPath,
      'node_modules',
      packageName,
      'package.json',
    )
    const packageJson = fs.readJsonSync(packageJsonPath)

    if (packageJson.bin?.[binName]) {
      return path.resolve(
        path.dirname(packageJsonPath),
        packageJson.bin[binName],
      )
    }

    throw new Error(`Bin '${binName}' not found in ${packageName} package.json`)
  } catch (error) {
    console.error(`Error finding bin path for ${packageName}:`, error)
    throw error
  }
}

// Parse input
const args = yargs(hideBin(process.argv))
  .positional('project-directory', {
    type: 'string',
    describe: 'The project directory to run the k6 tests in',
    demandOption: false,
  })
  .option('setup', { default: [], type: 'array', alias: 's' })
  .option('test', { default: [], type: 'array', alias: 't' })
  .option('clean-up', { default: true, type: 'boolean' })
  .option('verbose', { default: false, type: 'boolean' })
  .help()
  .parseSync()

const REDWOODJS_FRAMEWORK_PATH = path.join(__dirname, '..', '..')
const REDWOOD_PROJECT_DIRECTORY =
  args._?.[0]?.toString() ??
  path.join(
    os.tmpdir(),
    'redwood-k6-test',
    // ":" is problematic with paths
    new Date().toISOString().split(':').join('-'),
  )

const SETUPS_DIR = path.join(__dirname, 'setups')
const TESTS_DIR = path.join(__dirname, 'tests')

// Function to get API server commands with dynamic bin paths
function getApiServerCommands(projectPath: string) {
  const cliPath = findBinPath(projectPath, '@cedarjs/cli', 'rw')
  const apiServerPath = findBinPath(
    projectPath,
    '@cedarjs/api-server',
    'rw-server',
  )

  return [
    {
      cmd: `node ${cliPath} serve api`,
      host: 'http://localhost:8911',
    },
    {
      cmd: `node ${apiServerPath} api`,
      host: 'http://localhost:8911',
    },
  ]
}
let cleanUpExecuted = false

let serverSubprocess: ExecaChildProcess | undefined
const startServer = async (command: string, gracePeriod?: number) => {
  serverSubprocess = execa.command(command, {
    cwd: REDWOOD_PROJECT_DIRECTORY,
    stdio: args.verbose ? 'inherit' : 'ignore',
  })
  await new Promise((r) => setTimeout(r, gracePeriod ?? 4000))
}
const stopServer = async () => {
  if (!serverSubprocess) {
    return
  }
  serverSubprocess.cancel()
  try {
    await serverSubprocess
  } catch {
    // ignore
  }
}

async function main() {
  const divider = ansis.blue('~'.repeat(process.stdout.columns))

  console.log(`${divider}\nK6 tests\n${divider}`)
  console.log('Benchmark tests will be run in the following directory:')
  console.log(`${REDWOOD_PROJECT_DIRECTORY}`)

  fs.mkdirSync(REDWOOD_PROJECT_DIRECTORY, { recursive: true })

  // Register clean up
  if (args.cleanUp) {
    console.log('\nThe directory will be deleted after the tests are run')
    process.on('SIGINT', () => {
      if (!cleanUpExecuted) {
        cleanUp({
          projectPath: REDWOOD_PROJECT_DIRECTORY,
        })
        cleanUpExecuted = true
      }
    })
    process.on('exit', () => {
      if (!cleanUpExecuted) {
        cleanUp({
          projectPath: REDWOOD_PROJECT_DIRECTORY,
        })
        cleanUpExecuted = true
      }
    })
  }

  // Get all the setups
  const setups = fg
    .sync('*', {
      onlyDirectories: true,
      cwd: SETUPS_DIR,
    })
    .filter((setupDir) => {
      return (
        args.setup.length === 0 ||
        args.setup.some((setup) => setupDir.includes(setup.toString()))
      )
    })

  if (setups.length === 0) {
    console.log('There are no setups to run.')
    process.exit(0)
  }

  // Create a test project and sync the current framework state
  console.log('\nCreating a fresh project:')

  console.log('- building the framework')
  buildRedwoodFramework({
    frameworkPath: REDWOODJS_FRAMEWORK_PATH,
    verbose: args.verbose,
  })
  console.log('- creating a new project')
  createRedwoodJSApp({
    frameworkPath: REDWOODJS_FRAMEWORK_PATH,
    projectPath: REDWOOD_PROJECT_DIRECTORY,
    typescript: true,
    verbose: args.verbose,
  })
  console.log('- syncing the framework dependencies')
  addFrameworkDepsToProject({
    frameworkPath: REDWOODJS_FRAMEWORK_PATH,
    projectPath: REDWOOD_PROJECT_DIRECTORY,
    verbose: args.verbose,
  })
  console.log('- installing dependencies')
  runYarnInstall({
    projectPath: REDWOOD_PROJECT_DIRECTORY,
    verbose: args.verbose,
  })
  console.log('- copying framework packages')
  copyFrameworkPackages({
    frameworkPath: REDWOODJS_FRAMEWORK_PATH,
    projectPath: REDWOOD_PROJECT_DIRECTORY,
    verbose: args.verbose,
  })
  console.log('- initializing git')
  initGit({
    projectPath: REDWOOD_PROJECT_DIRECTORY,
    verbose: args.verbose,
  })

  // Results collection
  const results: Record<string, Record<string, any>> = {}

  console.log('The following setups will be run:')
  for (const setup of setups) {
    console.log('-', setup)
  }

  for (const setup of setups) {
    // import the setup
    const setupFile = path.join(SETUPS_DIR, setup, 'setup.mjs')
    const setupModule = await import(setupFile)
    const runForTests =
      args.test.length === 0
        ? setupModule.validForTests
        : args.test.filter((test) => setupModule.validForTests.includes(test))

    console.log(`\n${divider}\nPreparing setup: ${setup}\n${divider}`)

    if (runForTests.length === 0) {
      console.log(`There are no tests to run for setup ${setup}, skipping...`)
      continue
    }

    // Clean up the project state
    console.log(`Cleaning up the project state...`)
    await execa('git', ['reset', '--hard'], {
      cwd: REDWOOD_PROJECT_DIRECTORY,
      stdio: args.verbose ? 'inherit' : 'ignore',
    })
    await execa('git', ['clean', '-fd'], {
      cwd: REDWOOD_PROJECT_DIRECTORY,
      stdio: args.verbose ? 'inherit' : 'ignore',
    })

    // Run the setup
    console.log(`Running setup: ${setup}`)
    await setupModule.setup({
      projectPath: REDWOOD_PROJECT_DIRECTORY,
    })

    // Build the app
    console.log('Building the project...')
    await execa('yarn', ['rw', 'build'], {
      cwd: REDWOOD_PROJECT_DIRECTORY,
      stdio: args.verbose ? 'inherit' : 'ignore',
    })

    // Get API server commands with dynamic paths
    const apiServerCommands = getApiServerCommands(REDWOOD_PROJECT_DIRECTORY)

    // Run the tests
    for (let i = 0; i < runForTests.length; i++) {
      // Run for different server commands
      for (let j = 0; j < apiServerCommands.length; j++) {
        console.log(`\n${divider}`)
        console.log(
          `Running test ${i * apiServerCommands.length + j + 1}/${runForTests.length * apiServerCommands.length}: ${runForTests[i]}`,
        )
        console.log(ansis.dim(apiServerCommands[j].cmd))
        console.log(`${divider}`)

        // Start the server
        await startServer(
          apiServerCommands[j].cmd,
          setupModule.startupGracePeriod,
        )

        // Run k6 test
        let passed = false
        try {
          await execa(
            'k6',
            [
              'run',
              path.join(TESTS_DIR, `${runForTests[i]}.js`),
              '--env',
              `TEST_HOST=${apiServerCommands[j].host}`,
            ],
            {
              cwd: REDWOOD_PROJECT_DIRECTORY,
              stdio: 'inherit',
            },
          )
          passed = true
        } catch {
          // ignore
        }

        results[setup] ??= {}
        results[setup][runForTests[i]] ??= {}
        results[setup][runForTests[i]][apiServerCommands[j].cmd] =
          fs.readJSONSync(
            path.join(REDWOOD_PROJECT_DIRECTORY, 'summary.json'),
            {
              throws: false,
              flag: 'r',
              encoding: 'utf-8',
            },
          ) ?? {}
        results[setup][runForTests[i]][apiServerCommands[j].cmd].passed = passed

        // Stop the server
        await stopServer()
      }
    }
  }

  // Print results
  console.log(`\n${divider}\nResults:\n${divider}`)
  for (const setup in results) {
    console.log(ansis.bgBlue(`\nSetup: ${setup}`))
    for (const test in results[setup]) {
      for (const serverCommand in results[setup][test]) {
        const passed = results[setup][test][serverCommand].passed
        const bgColor = passed ? ansis.bgGreen : ansis.bgRed
        const bgPrefix = bgColor(' ')
        console.log(passed ? bgColor(' PASS ') : bgColor(' FAIL '))
        console.log(`${bgPrefix} Test: ${test} [${serverCommand}]`)
        console.log(
          `${bgPrefix}   Requests: ${results[setup][test][serverCommand].metrics?.http_reqs.values.count}`,
        )
        console.log(
          `${bgPrefix}   Duration (p90): ${results[setup][test][serverCommand].metrics?.http_req_duration.values['p(90)'].toFixed(3)}`,
        )
        console.log(
          `${bgPrefix}   TTFB (p90): ${results[setup][test][serverCommand].metrics?.http_req_waiting.values['p(90)'].toFixed(3)}`,
        )
        console.log()
      }
    }
  }

  process.emit('SIGINT')
}

main()
