#!/usr/bin/env node
/* eslint-env node, es6*/

const os = require('os')
const path = require('path')

const execa = require('execa')
const fg = require('fast-glob')
const fs = require('fs-extra')
const { hideBin } = require('yargs/helpers')
const yargs = require('yargs/yargs')

// This script sets up a blank CedarJS app into a directory.
// It uses the packages from the CedarJS framework (../packages).
// So, if you're making changes to the framework,
// you can use the e2e tests to verify your changes.
//
// The steps are composable, so that it can work for the GitHub Workflow, and
// us contributors.

const makeDirectory = () => {
  console.log('mkdir', CEDARJS_PROJECT_DIRECTORY)
  fs.mkdirSync(CEDARJS_PROJECT_DIRECTORY, { recursive: true })
  return CEDARJS_PROJECT_DIRECTORY
}

function buildCedarJsFramework() {
  try {
    const files = fg.sync('packages/**/dist', {
      onlyDirectories: true,
    })

    execa.sync(
      [files.length && 'yarn build:clean', 'yarn build']
        .filter(Boolean)
        .join('&&'),
      {
        cwd: CEDARJS_FRAMEWORK_PATH,
        shell: true,
        stdio: 'inherit',
      },
    )
  } catch (e) {
    if (e.signal !== 'SIGINT') {
      console.error('Error: Could not build Cedar Framework')
      console.error(e)
    }
    process.exit(1)
  }
}

function createCedarJsApp({ typescript }) {
  try {
    execa.sync(
      'yarn node dist/create-cedar-app.js',
      [
        CEDARJS_PROJECT_DIRECTORY,
        '--no-yarn-install',
        `--typescript ${typescript}`,
        '--no-telemetry',
        '--git',
        '-m "first"',
      ].filter(Boolean),
      {
        cwd: path.join(CEDARJS_FRAMEWORK_PATH, 'packages/create-cedar-app'),
        env: { REDWOOD_CI: '1' },
        shell: true,
        stdio: 'inherit',
      },
    )

    // Add package resolutions
    //
    // This is needed because the test project uses the current stable version
    // of CedarJS when installing, but then when we use rwfw to link, newer
    // versions of packages might be installed causing conflicts. Setting
    // resolutions prevents this.
    // Note that this isn't limited to any specific versions. It's always
    // going to be a potential issue when package versions differ between
    // stable and canary.
    // See https://github.com/redwoodjs/redwood/pull/6772 for more info.

    const packageJSONPath = path.join(CEDARJS_PROJECT_DIRECTORY, 'package.json')
    const packageJSON = fs.readJSONSync(packageJSONPath)

    const getVersionFromRwPackage = (dep, pkg) => {
      return fs.readJSONSync(
        path.join(CEDARJS_FRAMEWORK_PATH, 'packages', pkg, 'package.json'),
      ).dependencies[dep]
    }

    packageJSON.resolutions = {
      prisma: getVersionFromRwPackage('prisma', 'cli'),
      '@prisma/client': getVersionFromRwPackage('@prisma/client', 'api'),
      '@prisma/internals': getVersionFromRwPackage('@prisma/internals', 'cli'),
      'graphql-yoga': getVersionFromRwPackage('graphql-yoga', 'graphql-server'),
      graphql: getVersionFromRwPackage('graphql', 'graphql-server'),
    }

    fs.writeFileSync(packageJSONPath, JSON.stringify(packageJSON, null, 2))
  } catch (e) {
    if (e.signal !== 'SIGINT') {
      console.error('Error: Could not create CedarJS Project')
      console.error(e)
    }
    process.exit(1)
  }
}

const runTarsync = () => {
  try {
    execa.sync('yarn project:tarsync -v', {
      cwd: CEDARJS_FRAMEWORK_PATH,
      shell: true,
      stdio: 'inherit',
      env: {
        RWFW_PATH: CEDARJS_FRAMEWORK_PATH,
        RWJS_CWD: CEDARJS_PROJECT_DIRECTORY,
      },
    })
  } catch (e) {
    if (e.signal !== 'SIGINT') {
      console.error(
        'Error: Could not tarsync framework dependencies/code to project',
      )
      console.error(e)
    }
    process.exit(1)
  }
}

const runDevServerInBackground = () => {
  try {
    console.log('Starting CedarJS dev server...')
    execa('yarn cedar dev --no-generate --fwd="--no-open"', {
      cwd: CEDARJS_PROJECT_DIRECTORY,
      shell: true,
      stdio: 'inherit',
      env: {
        RWJS_DELAY_RESTART: '500',
        REDWOOD_CI: '1',
      },
    })
  } catch (e) {
    if (e.signal !== 'SIGINT') {
      console.error('There was an error with the CedarJS dev server:')
      console.error(e)
    }
    process.exit(1)
  }
}

const runCypress = () => {
  try {
    console.log('Starting Cypress...')
    execa.sync(
      // do not use Yarn to run Cypress; this avoids missing binary errors
      '../../node_modules/.bin/cypress',
      [
        'open',
        `--env RW_PATH=${CEDARJS_PROJECT_DIRECTORY}`,
        '--e2e',
        '--browser chrome',
      ],
      {
        cwd: path.join(CEDARJS_FRAMEWORK_PATH, 'tasks/e2e'),
        shell: true,
        stdio: 'inherit',
      },
    )
  } catch (e) {
    if (e.signal !== 'SIGINT') {
      console.error('There was an error with Cypress:')
      console.error(e)
    }
    process.exit(1)
  }
}

const initGit = () => {
  try {
    console.log('Initializing Git')
    execa.sync('git init --initial-branch main && git add .', {
      cwd: CEDARJS_PROJECT_DIRECTORY,
      shell: true,
      stdio: 'inherit',
    })
    execa.sync('git commit -a --message=init', {
      cwd: CEDARJS_PROJECT_DIRECTORY,
      shell: true,
      stdio: 'inherit',
    })
  } catch (e) {
    if (e.signal !== 'SIGINT') {
      console.error(
        'There was an error with the `git init` or `git commit` step:',
      )
      console.error(e)
    }
    process.exit(1)
  }
}

const args = yargs(hideBin(process.argv))
  .option('create-project', { default: true, type: 'boolean', alias: 'create' })
  .option('build-framework', { default: true, type: 'boolean', alias: 'build' })
  .option('copy-framework', { default: true, type: 'boolean', alias: 'copy' })
  .option('typescript', { default: false, type: 'boolean', alias: 'ts' })
  .option('auto-start', { default: true, type: 'boolean', alias: 'start' })
  .option('clean-files', { default: true, type: 'boolean' })
  .scriptName('run-e2e')
  .example('run-e2e')
  .example('run-e2e /tmp/cedar-app --ts')
  .help()
  .parse()

const CEDARJS_FRAMEWORK_PATH = path.resolve(__dirname, '..')
let CEDARJS_PROJECT_DIRECTORY =
  args._?.[0] ||
  path.join(
    os.tmpdir(),
    'cedar-e2e',
    // ":" is problematic with paths
    new Date().toISOString().split(':').join('-'),
  )

console.log()
console.log('-'.repeat(80))
console.log()
makeDirectory(CEDARJS_PROJECT_DIRECTORY)
console.log()
console.log('-'.repeat(80))

const {
  buildFramework,
  copyFramework,
  createProject,
  typescript,
  autoStart,
  cleanFiles,
} = args
const tasks = [
  buildFramework && buildCedarJsFramework,
  createProject && (() => createCedarJsApp({ typescript })),
  copyFramework && runTarsync,
  autoStart && runDevServerInBackground,
  autoStart && initGit,
  autoStart && runCypress,
].filter(Boolean)

process.on('SIGINT', () => {
  process.exit(0)
})

process.on('exit', () => {
  console.log('')
  console.log('-'.repeat(80))
  if (cleanFiles && autoStart) {
    console.log('Cleaning up e2e resources...')
    console.log(' - Cleaning up files (may take a few seconds)...')
    fs.rmSync(CEDARJS_PROJECT_DIRECTORY, { recursive: true, force: true })
    console.log('Clean up complete')
  } else {
    console.log(
      `E2E files within "${CEDARJS_PROJECT_DIRECTORY}" have not been automatically cleaned up.`,
    )
  }
})

for (const task of tasks) {
  console.log()
  task()
  console.log()
  console.log('-'.repeat(80))
}
