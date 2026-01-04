#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import ansis from 'ansis'
import execa from 'execa'
import { Listr } from 'listr2'
import { rimraf } from 'rimraf'
import { hideBin } from 'yargs/helpers'
import yargs from 'yargs/yargs'

import { apiTasks, streamingTasks, webTasks } from './tasks.mjs'
import { confirmNoFixtureNoLink, getExecaOptions, getCfwBin } from './util.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const args = yargs(hideBin(process.argv))
  .usage('Usage: $0 <project directory> [option]')
  .demandCommand(1, 'Please provide a project directory')
  .option('link', {
    default: false,
    type: 'boolean',
    describe:
      'Link the current checked out branch of the framework in the project',
  })
  .option('verbose', {
    default: false,
    type: 'boolean',
    describe: 'Verbose output',
  })
  .option('copyFromFixture', {
    default: true,
    type: 'boolean',
    describe: 'Copy the test project from the __fixtures__ folder',
  })
  .option('streamingSsr', {
    default: false,
    type: 'boolean',
    describe: 'Enable streaming-ssr experiment (RW v7)',
  })
  .option('clean', {
    default: false,
    type: 'boolean',
    describe: 'Delete existing directory, and recreate project',
  })
  .option('canary', {
    default: true,
    type: 'boolean',
    describe:
      'Upgrade project to latest canary version. NOT compatible with --link.',
  })
  .option('javascript', {
    default: false,
    type: 'boolean',
    describe: 'Build a Javascript project.',
  })
  .help()
  .parseSync()

const {
  canary,
  link,
  verbose,
  clean,
  copyFromFixture,
  javascript,
  streamingSsr,
} = args

if (args._.length > 1) {
  console.log(
    ansis.red.bold(
      `
      Multiple <project directory> arguments
      Specify ONE project directory outside the framework directory (no spaces allowed)
      EXAMPLE: 'yarn build:test-project ../test-project'
      `,
    ),
  )
  process.exit(1)
}

const OUTPUT_PROJECT_PATH = path.resolve(String(args._[0]))
const CEDAR_FRAMEWORK_PATH = path.join(__dirname, '../../')

// Project Directory path check: must not be a subdirectory or Yarn will error
const relativePathCheck = path.relative(
  CEDAR_FRAMEWORK_PATH,
  OUTPUT_PROJECT_PATH,
)

if (
  relativePathCheck &&
  !relativePathCheck.startsWith('..') &&
  !path.isAbsolute(relativePathCheck)
) {
  console.log(
    ansis.red.bold(
      `
      Project Directory CANNOT be a subdirectory of '${CEDAR_FRAMEWORK_PATH}'
      Specify a project directory outside the framework directory
      EXAMPLE: 'yarn build:test-project ../test-project'
      `,
    ),
  )

  process.exit(1)
}

const createProject = async () => {
  if (clean) {
    await rimraf(OUTPUT_PROJECT_PATH)
  }

  const cmd = `yarn node ./packages/create-cedar-app/dist/create-cedar-app.js ${OUTPUT_PROJECT_PATH}`

  // We create a ts project and convert using ts-to-js at the end if typescript flag is false
  return execa(
    cmd,
    ['--no-yarn-install', '--typescript', '--overwrite', '--no-git'],
    getExecaOptions(CEDAR_FRAMEWORK_PATH),
  )
}

const copyProject = async () => {
  if (clean) {
    await rimraf(OUTPUT_PROJECT_PATH)
  }

  const FIXTURE_TESTPROJ_PATH = path.join(
    CEDAR_FRAMEWORK_PATH,
    '__fixtures__/test-project',
  )

  // copying existing Fixture to new Project
  fs.cpSync(FIXTURE_TESTPROJ_PATH, OUTPUT_PROJECT_PATH, { recursive: true })

  // Make sure no lockfiles are accidentally copied
  fs.rmSync(path.join(OUTPUT_PROJECT_PATH, 'yarn.lock'), { force: true })
}

const globalTasks = () =>
  new Listr(
    [
      {
        title: 'Creating project',
        task: (_ctx, task) => {
          if (copyFromFixture) {
            task.output =
              'Copying test-project from __fixtures__/test-project...'
            return copyProject()
          } else {
            task.output = 'Building test-project from scratch...'
            return createProject()
          }
        },
      },
      {
        title: 'Installing node_modules',
        task: async () => {
          return execa('yarn install', getExecaOptions(OUTPUT_PROJECT_PATH))
        },
      },
      {
        title: 'Tarsync the framework to the project',
        task: () => {
          return execa(
            `yarn ${getCfwBin(OUTPUT_PROJECT_PATH)} project:tarsync`,
            [],
            getExecaOptions(OUTPUT_PROJECT_PATH),
          )
        },
        enabled: () => link,
      },
      {
        title: 'Converting to Javascript',
        task: () => {
          return execa(
            'yarn cedar ts-to-js',
            [],
            getExecaOptions(OUTPUT_PROJECT_PATH),
          )
        },
        enabled: () => javascript,
      },
      {
        title: 'Upgrading to latest canary version',
        task: async () => {
          return execa(
            'yarn cedar upgrade -t canary',
            [],
            getExecaOptions(OUTPUT_PROJECT_PATH),
          )
        },
        enabled: () => (canary && !link) || streamingSsr,
      },
      {
        title: 'Apply web codemods',
        task: () =>
          webTasks(OUTPUT_PROJECT_PATH, {
            verbose,
            linkWithLatestFwBuild: link,
          }),
        enabled: () => !copyFromFixture,
      },
      {
        // These are also web tasks... we can move them into the webTasks function
        // when streaming isn't experimental
        title: 'Enabling streaming-ssr experiment and applying codemods....',
        task: () => streamingTasks(OUTPUT_PROJECT_PATH, { verbose }),
        enabled: () => streamingSsr,
      },
      {
        title: 'Apply api codemods',
        task: () =>
          apiTasks(OUTPUT_PROJECT_PATH, {
            verbose,
            linkWithLatestFwBuild: link,
          }),
        enabled: () => !copyFromFixture,
      },
      {
        title: 'Generate dbAuth Secret',
        task: async () => {
          const { stdout: dbAuthSecret } = await execa(
            'yarn',
            ['rw', 'g', 'secret', '--raw'],
            {
              ...getExecaOptions(OUTPUT_PROJECT_PATH),
              stdio: 'pipe',
            },
          )

          fs.appendFileSync(
            path.join(OUTPUT_PROJECT_PATH, '.env'),
            `SESSION_SECRET=${dbAuthSecret}`,
          )
        },
      },
      {
        title: 'Running prisma migrate reset',
        task: () => {
          return execa(
            'yarn cedar prisma migrate reset',
            ['--force'],
            getExecaOptions(OUTPUT_PROJECT_PATH),
          )
        },
      },
      {
        title: 'Lint --fix all the things',
        task: async () => {
          try {
            await execa('yarn cedar lint --fix', {
              shell: true,
              stdio: 'ignore',
              cleanup: true,
              cwd: OUTPUT_PROJECT_PATH,
              env: {
                RW_PATH: path.join(__dirname, '../../'),
              },
            })
          } catch {
            // nothing to see here
          }
        },
        enabled: () => !copyFromFixture,
      },
      {
        title: 'All done!',
        task: async (_ctx, task) => {
          if (verbose) {
            // Without verbose these logs aren't visible anyway
            console.log()
            console.log('-'.repeat(30))
            console.log()
            console.log('✅ Success your project has been generated at:')
            console.log(OUTPUT_PROJECT_PATH)
            console.log()
            console.log('-'.repeat(30))
          } else {
            task.output = `Generated project at ${OUTPUT_PROJECT_PATH}`
          }
        },
      },
    ],
    {
      exitOnError: true,
      renderer: verbose ? 'verbose' : 'default',
      rendererOptions: { collapseSubtasks: false },
    },
  )

async function runCommand() {
  // confirm usage for case raw build without Link
  if (!copyFromFixture && !link) {
    // if prompt returns 'no', exit
    if (!(await confirmNoFixtureNoLink(copyFromFixture, link))) {
      process.exit(1)
    }
  }

  try {
    await globalTasks().run()
  } catch (err) {
    console.error(err)
    process.exit(1)
  }
}

runCommand()
