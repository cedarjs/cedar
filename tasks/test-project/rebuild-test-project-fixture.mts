import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { startPrismaDevServer } from '@prisma/dev'
import ansis from 'ansis'
import { rimraf } from 'rimraf'
import semver from 'semver'
import { hideBin } from 'yargs/helpers'
import yargs from 'yargs/yargs'

import { RedwoodTUI, ReactiveTUIContent, RedwoodStyling } from '@cedarjs/tui'

import { apiTasksList } from './base-tasks.mts'
import {
  addFrameworkDepsToProject,
  copyFrameworkPackages,
} from './frameworkLinking.mts'
import { setOutputPath } from './paths.mts'
import { webTasks } from './tui-tasks.mts'
import { isAwaitable, isTuiError } from './typing.mts'
import type { TuiTaskDef } from './typing.mts'
import {
  getExecaOptions as utilGetExecaOptions,
  updatePkgJsonScripts,
  ExecaError,
  exec,
  getCfwBin,
} from './util.mts'

function recommendedNodeVersion() {
  const templatePackageJsonPath = path.join(
    import.meta.dirname,
    '..',
    '..',
    'packages',
    'create-cedar-app',
    'templates',
    'ts',
    'package.json',
  )
  const json = JSON.parse(fs.readFileSync(templatePackageJsonPath, 'utf8'))

  return json.engines.node
}

// If the current Node.js version is outside of the recommended range the Cedar
// setup command will pause and ask the user if they want to continue. This
// hangs this script without any information to the user that tries to rebuild
// the test-project. It's better to fail early so the correct node version can
// be installed.
if (!semver.satisfies(process.version, recommendedNodeVersion())) {
  console.error('Unsupported Node.js version')
  console.error('  You are using:', process.version)
  console.error('  Supported version:', recommendedNodeVersion())
  process.exit(1)
}

const args = yargs(hideBin(process.argv))
  .usage('Usage: $0 [option]')
  .option('verbose', {
    default: false,
    type: 'boolean',
    describe: 'Verbose output',
  })
  .option('resume', {
    default: false,
    type: 'boolean',
    describe: 'Resume rebuild of the latest unfinished test-project',
  })
  .option('resumePath', {
    type: 'string',
    describe: 'Resume rebuild given the specified test-project path',
  })
  .option('resumeStep', {
    type: 'string',
    describe: 'Resume rebuild from the given step',
  })
  .option('live', {
    default: false,
    type: 'boolean',
    describe:
      'Rebuild the @live test-project, using pglite for PostgreSQL-' +
      'compatible migrations',
  })
  .help()
  .parseSync()

const { verbose, resume, resumePath, resumeStep, live } = args

const folderSuffix = live ? '-live' : ''

const CEDAR_FRAMEWORK_PATH = path.join(import.meta.dirname, '../../')
const OUTPUT_PROJECT_PATH = resumePath
  ? /* path.resolve(String(resumePath)) */ resumePath
  : path.join(
      os.tmpdir(),
      'cedar-test-project' + folderSuffix,
      // ":" is problematic with paths
      new Date().toISOString().split(':').join('-'),
    )

let startStep = resumeStep || ''

if (!startStep) {
  // Figure out what step to restart the rebuild from
  try {
    const stepTxt = fs.readFileSync(
      path.join(OUTPUT_PROJECT_PATH, 'step.txt'),
      'utf-8',
    )

    if (stepTxt) {
      startStep = stepTxt
    }
  } catch {
    // No step.txt file found, start from the beginning
  }
}

const tui = new RedwoodTUI()

function getExecaOptions(cwd: string) {
  return { ...utilGetExecaOptions(cwd), stdio: 'pipe' as const }
}

function beginStep(step: string) {
  fs.mkdirSync(OUTPUT_PROJECT_PATH, { recursive: true })
  fs.writeFileSync(path.join(OUTPUT_PROJECT_PATH, 'step.txt'), '' + step)
}

/**
 * stepTimings collects timing information for each step/sub-step keyed by
 * their stepId (e.g. "7", "8.1", etc).
 *
 * Each entry will contain:
 *  - startTime: number (ms)
 *  - endTime: number (ms)
 *  - durationMs: number
 *  - skipped?: boolean
 */
const stepTimings: Record<
  string,
  {
    startTime?: number
    endTime?: number
    durationMs?: number
    skipped?: boolean
  }
> = {}

async function tuiTask({ step, title, content, task, parent }: TuiTaskDef) {
  const stepId = (parent ? parent + '.' : '') + step

  const tuiContent = new ReactiveTUIContent({
    mode: 'text',
    header: `${stepId}: ${title}`,
    content,
    spinner: {
      enabled: true,
    },
  })

  tui.startReactive(tuiContent)

  beginStep(stepId)

  let skip = skipFn(startStep, stepId)

  // record start time for this step
  const startTime = Date.now()
  stepTimings[stepId] = { startTime }

  if (skip) {
    if (typeof skip === 'boolean' && skip) {
      // if skip is just `true`, then we use the default skip message
      skip = 'Skipping...'
    }

    // mark skipped and set duration to 0
    stepTimings[stepId].skipped = true
    stepTimings[stepId].endTime = Date.now()
    stepTimings[stepId].durationMs = 0

    tuiContent.update({
      spinner: {
        enabled: false,
      },
      header: `${RedwoodStyling.green('✔')} ${step}. ${title}`,
      content: ' '.repeat(stepId.length + 4) + RedwoodStyling.info(skip) + '\n',
    })

    tui.stopReactive()

    return
  }

  let promise: void | Promise<unknown>

  try {
    promise = task()
  } catch (e) {
    // This code handles errors from synchronous tasks

    // capture end time on failure
    const end = Date.now()
    stepTimings[stepId].endTime = end
    const start = stepTimings[stepId].startTime ?? end
    stepTimings[stepId].durationMs = end - start

    tui.stopReactive(true)

    if (e instanceof ExecaError) {
      tui.displayError(
        'Failed ' + title.toLowerCase().replace('...', ''),
        'stdout:\n' + e.stdout + '\n\n' + 'stderr:\n' + e.stderr,
      )
    } else {
      const message = isTuiError(e) ? e.message : ''
      const errorTitle = title?.toLowerCase().replace('...', '') || '<no title>'

      tui.displayError('Failed ' + errorTitle, message || '')
    }

    const exitCode = isTuiError(e) ? e.exitCode : 1
    process.exit(exitCode)
  }

  if (isAwaitable(promise)) {
    const result = await promise.catch((e) => {
      // capture end time on async failure
      const end = Date.now()
      stepTimings[stepId].endTime = end
      const start = stepTimings[stepId].startTime ?? end
      stepTimings[stepId].durationMs = end - start

      // This code handles errors from asynchronous tasks

      tui.stopReactive(true)

      if (e instanceof ExecaError) {
        tui.displayError(
          'Failed ' + title.toLowerCase().replace('...', ''),
          'stdout:\n' + e.stdout + '\n\n' + 'stderr:\n' + e.stderr,
        )
      } else {
        tui.displayError(
          'Failed ' + title.toLowerCase().replace('...', ''),
          e.message,
        )
      }

      // Ensure we always exit non-zero on errors. Default to 1 if no exitCode.
      process.exit(e.exitCode ?? 1)
    })

    if (Array.isArray(result)) {
      const tuiTaskList = result
      for (let i = 0; i < tuiTaskList.length; i++) {
        // Recurse through all tasks
        await tuiTask({
          step: i,
          ...tuiTaskList[i],
          parent: stepId,
        })
      }
    }
  }

  // capture end time and compute duration
  const endTime = Date.now()
  stepTimings[stepId].endTime = endTime
  const startTimeVal = stepTimings[stepId].startTime ?? endTime
  stepTimings[stepId].durationMs = endTime - startTimeVal

  const durationMs = stepTimings[stepId].durationMs ?? 0
  const durationStr = `${(durationMs / 1000).toFixed(2)}s`

  tuiContent.update({
    spinner: {
      enabled: false,
    },
    header: `${RedwoodStyling.green('✔')} ${stepId}: ${title} (${durationStr})`,
    content: '',
  })

  tui.stopReactive()
}

/**
 * Function that returns a string to show when skipping the task, or just
 * true|false to indicate whether the task should be skipped or not.
 */
function skipFn(startStep: string, currentStep: string) {
  const startStepNrs = startStep.split('.').map((s) => parseInt(s, 10))
  const currentStepNrs = currentStep.split('.').map((s) => parseInt(s, 10))

  for (let i = 0; i < startStepNrs.length; i++) {
    if (startStepNrs[i] > currentStepNrs[i]) {
      return 'Skipping... Resuming from step ' + startStep
    }
  }

  return false
}

if (resume) {
  console.error(
    ansis.red.bold(
      '\n`resume` option is not supported yet. ' +
        'Please use `resumePath` instead.\n',
    ),
  )

  process.exit(1)
}

if (
  resumePath &&
  !fs.existsSync(path.join(resumePath, 'cedar.toml')) &&
  !fs.existsSync(path.join(resumePath, 'redwood.toml'))
) {
  console.error(
    ansis.red.bold(
      `
      No cedar.toml (or redwood.toml) file found at the given path: ${resumePath}
      `,
    ),
  )
  process.exit(1)
}

const createProject = () => {
  const cmd = `yarn node ./packages/create-cedar-app/dist/create-cedar-app.js ${OUTPUT_PROJECT_PATH}`

  const subprocess = exec(
    cmd,
    // We create a ts project and convert using ts-to-js at the end if typescript flag is false
    ['--no-yarn-install', '--typescript', '--overwrite', '--no-git'],
    getExecaOptions(CEDAR_FRAMEWORK_PATH),
  )

  return subprocess
}

const copyProject = async () => {
  const fixturePath = path.join(
    CEDAR_FRAMEWORK_PATH,
    '__fixtures__',
    'test-project' + folderSuffix,
  )

  // remove existing Fixture
  await rimraf(fixturePath)
  // copy from tempDir to Fixture dir
  await fs.promises.cp(OUTPUT_PROJECT_PATH, fixturePath, { recursive: true })
  // cleanup after ourselves
  await rimraf(OUTPUT_PROJECT_PATH)
}

async function rebuildTestProject() {
  console.log()
  console.log('Rebuilding test project fixture...')
  console.log('Using temporary directory:', OUTPUT_PROJECT_PATH)
  console.log()

  const overallStart = Date.now()

  let localPrisma: Awaited<ReturnType<typeof startPrismaDevServer>> | undefined
  if (live) {
    localPrisma = await startPrismaDevServer()
  }

  // Maybe we could add all of the tasks to an array and infer the `step` from
  // the array index?
  // I'd also want to be able to skip sub-tasks. Like both the "web" step and
  // the "api" step both have a bunch of sub-tasks. So maybe the step.txt file
  // should contain something like "9.2" to mean the third sub-task of the
  // "api" step? And --resume-step would also accept stuff like "9.2"?

  // TODO: Maybe it's enough to just build create-cedar-app
  await tuiTask({
    step: 0,
    title: 'Building Cedar framework',
    content: 'yarn clean && yarn build',
    task: async () => {
      return exec(
        'yarn clean && yarn build',
        [],
        getExecaOptions(CEDAR_FRAMEWORK_PATH),
      )
    },
  })

  await tuiTask({
    step: 1,
    title: 'Creating project',
    content: 'Building test-project from scratch...',
    task: createProject,
  })

  // TODO: See if this is needed now with tarsync
  await tuiTask({
    step: 2,
    title: '[link] Adding framework dependencies to project',
    content: 'Adding framework dependencies to project...',
    task: () => {
      return addFrameworkDepsToProject(
        CEDAR_FRAMEWORK_PATH,
        OUTPUT_PROJECT_PATH,
        'pipe', // TODO: Remove this when everything is using @rwjs/tui
      )
    },
  })

  await tuiTask({
    step: 3,
    title: 'Installing node_modules',
    content: 'yarn install',
    task: async () => {
      // TODO: See if this is needed now with tarsync
      await exec('yarn install', [], getExecaOptions(OUTPUT_PROJECT_PATH))

      // TODO: Now that I've added this, I wonder what other steps I can remove
      return exec(
        `yarn ${getCfwBin(OUTPUT_PROJECT_PATH)} project:tarsync`,
        [],
        getExecaOptions(OUTPUT_PROJECT_PATH),
      )
    },
  })

  await tuiTask({
    step: 4,
    title: 'Updating ports in cedar.toml (or redwood.toml)...',
    task: () => {
      // We do this, to make it easier to run multiple test projects in parallel
      // But on different ports. If API_DEV_PORT or WEB_DEV_PORT aren't supplied,
      // It just defaults to 8910 and 8911
      // This is helpful in playwright smoke tests to allow us to parallelize
      const cedarTomlPath = path.join(OUTPUT_PROJECT_PATH, 'cedar.toml')
      const rwTomlPath = path.join(OUTPUT_PROJECT_PATH, 'redwood.toml')
      const tomlPath = fs.existsSync(cedarTomlPath) ? cedarTomlPath : rwTomlPath
      const tomlContent = fs.readFileSync(tomlPath).toString()
      let newConfigToml = tomlContent

      newConfigToml = newConfigToml.replace(
        /\port = 8910/,
        'port = "${WEB_DEV_PORT:8910}"',
      )

      newConfigToml = newConfigToml.replace(
        /\port = 8911/,
        'port = "${API_DEV_PORT:8911}"',
      )

      fs.writeFileSync(tomlPath, newConfigToml)
    },
  })

  await tuiTask({
    step: 5,
    title: '[link] Copying framework packages to project',
    task: () => {
      return copyFrameworkPackages(
        CEDAR_FRAMEWORK_PATH,
        OUTPUT_PROJECT_PATH,
        'pipe',
      )
    },
  })

  // Note that we undo this at the end
  await tuiTask({
    step: 6,
    title: '[link] Add cfw project:copy postinstall',
    task: () => {
      return updatePkgJsonScripts({
        projectPath: OUTPUT_PROJECT_PATH,
        scripts: {
          postinstall: `yarn ${getCfwBin(OUTPUT_PROJECT_PATH)} project:copy`,
        },
      })
    },
  })

  await tuiTask({
    step: 7,
    title: (!live ? 'skip: ' : '') + 'Switch to PostgreSQL',
    task: () => {
      if (!live || !localPrisma) {
        return
      }

      const projectSchemaPath = path.join(
        OUTPUT_PROJECT_PATH,
        'api',
        'db',
        'schema.prisma',
      )
      const projectSchemaPrisma = fs.readFileSync(projectSchemaPath, 'utf-8')
      fs.writeFileSync(
        projectSchemaPath,
        projectSchemaPrisma.replace('sqlite', 'postgresql'),
      )

      const projectEnvPath = path.join(OUTPUT_PROJECT_PATH, '.env')
      const projectEnv = fs.readFileSync(projectEnvPath, 'utf-8')
      fs.writeFileSync(
        projectEnvPath,
        projectEnv + '\n\n' + 'DATABASE_URL=' + localPrisma.ppg.url,
      )
    },
  })

  await tuiTask({
    step: 8,
    title: 'Apply web codemods',
    task: () => {
      return webTasks(OUTPUT_PROJECT_PATH)
    },
  })

  await tuiTask({
    step: 9,
    title: 'Apply api codemods',
    task: async () => {
      setOutputPath(OUTPUT_PROJECT_PATH)

      return apiTasksList({ dbAuth: 'local', live })
    },
  })

  await tuiTask({
    step: 10,
    title: 'Add workspace packages',
    task: async () => {
      const cedarTomlPath = path.join(OUTPUT_PROJECT_PATH, 'cedar.toml')
      const rwTomlPath = path.join(OUTPUT_PROJECT_PATH, 'redwood.toml')
      const tomlPath = fs.existsSync(cedarTomlPath) ? cedarTomlPath : rwTomlPath
      const redwoodToml = fs.readFileSync(tomlPath, 'utf-8')
      const newRedwoodToml =
        redwoodToml + '\n[experimental.packagesWorkspace]\n  enabled = true\n'

      fs.writeFileSync(tomlPath, newRedwoodToml)

      await exec(
        'yarn cedar g package @my-org/validators --workspace both',
        [],
        getExecaOptions(OUTPUT_PROJECT_PATH),
      )

      const packagePath = path.join(
        OUTPUT_PROJECT_PATH,
        'packages',
        'validators',
      )

      fs.writeFileSync(
        path.join(packagePath, 'src', 'index.ts'),
        'export function validateEmail(email: string) {\n' +
          "  return email.includes('@') &&\n" +
          "    email.includes('.') &&\n" +
          "    email.lastIndexOf('.') > email.indexOf('@') + 1\n" +
          '}\n',
      )

      fs.writeFileSync(
        path.join(packagePath, 'src', 'validators.test.ts'),
        "import { validateEmail } from './index.js'\n" +
          '\n' +
          "describe('validators', () => {\n" +
          "  it('should not throw any errors', async () => {\n" +
          "    expect(validateEmail('valid@email.com')).not.toThrow()\n" +
          '  })\n' +
          '})\n',
      )

      const apiPackageJson = JSON.parse(
        fs.readFileSync(
          path.join(OUTPUT_PROJECT_PATH, 'api', 'package.json'),
          'utf8',
        ),
      )
      const webPackageJson = JSON.parse(
        fs.readFileSync(
          path.join(OUTPUT_PROJECT_PATH, 'web', 'package.json'),
          'utf8',
        ),
      )

      apiPackageJson.dependencies['@my-org/validators'] = 'workspace:*'
      webPackageJson.dependencies['@my-org/validators'] = 'workspace:*'

      fs.writeFileSync(
        path.join(OUTPUT_PROJECT_PATH, 'api', 'package.json'),
        JSON.stringify(apiPackageJson, null, 2),
      )
      fs.writeFileSync(
        path.join(OUTPUT_PROJECT_PATH, 'web', 'package.json'),
        JSON.stringify(webPackageJson, null, 2),
      )

      await exec('yarn install', [], getExecaOptions(OUTPUT_PROJECT_PATH))

      const build = await exec(
        'yarn cedar build --no-prerender',
        [],
        getExecaOptions(OUTPUT_PROJECT_PATH),
      )

      // Verify that we're not including test files in the build output
      const distFiles = fs.readdirSync(
        path.join(OUTPUT_PROJECT_PATH, 'packages', 'validators', 'dist'),
      )

      if (distFiles.some((file) => file.includes('test'))) {
        console.error('distFiles', distFiles)
        throw new Error(
          'Unexpected test file in validators package dist directory',
        )
      }

      // TODO: Update this when we refine the build process
      if (!build.stdout.includes('validators')) {
        console.error('yarn cedar build output', build.stdout, build.stderr)
        throw new Error(
          'Unexpected output from `yarn cedar build` ' +
            build.stdout +
            ' ' +
            build.stderr,
        )
      }

      if (build.exitCode !== 0) {
        throw new Error(
          'Unexpected exitCode from `yarn cedar build` ' +
            build.exitCode +
            ' ' +
            build.stdout +
            ' ' +
            build.stderr,
        )
      }

      // Verify that `yarn cedar <cmd>` works inside package directories
      // Starting with `yarn cedar info`
      // TODO: Enable code below
      // const info = await exec(
      //   'yarn cedar info',
      //   [],
      //   getExecaOptions(OUTPUT_PROJECT_PATH),
      // )

      // if (
      //   !info.stdout.includes('Binaries:') ||
      //   !info.stdout.includes('Node:') ||
      //   !info.stdout.includes('npmPackages:') ||
      //   !info.stdout.includes('@cedarjs/core')
      // ) {
      //   console.error('yarn cedar info output', info.stdout, info.stderr)

      //   throw new Error('Unexpected output from `yarn cedar info`')
      // }

      // Continue testing `yarn cedar <cmd>` by running `yarn cedar test`
      // const test = await exec(
      //   'yarn cedar test @my-org/validators',
      //   [],
      //   getExecaOptions(OUTPUT_PROJECT_PATH),
      // )

      // Validate that only the tests for this package ran
      // Verify that all tests passed
      // TODO: Implement functionality according to the comment above

      // The package we've generated (@my-org/validators) is used in the test
      // project on both the web and the api side and is further tested by our
      // playwright tests that trigger the files that import the package.
    },
  })

  await tuiTask({
    step: 11,
    title: 'Add scripts',
    task: async () => {
      const nestedPath = path.join(OUTPUT_PROJECT_PATH, 'scripts', 'one', 'two')

      fs.mkdirSync(nestedPath, { recursive: true })
      fs.writeFileSync(
        path.join(nestedPath, 'myNestedScript.ts'),
        "import { contacts } from 'api/src/services/contacts/contacts'\n" +
          '\n' +
          'export default async () => {\n' +
          '  const _allContacts = await contacts()\n' +
          "  console.log('Hello from myNestedScript.ts')\n" +
          '}\n\n',
      )

      await exec(
        'yarn cedar g script i/am/nested',
        [],
        getExecaOptions(OUTPUT_PROJECT_PATH),
      )

      // Verify that the scripts are added and included in the list of
      // available scripts
      const list = await exec(
        'yarn cedar exec',
        [],
        getExecaOptions(OUTPUT_PROJECT_PATH),
      )

      if (
        !list.stdout.includes('seed') ||
        !list.stdout.includes('i/am/nested') ||
        !list.stdout.includes('one/two/myNestedScript')
      ) {
        console.error('yarn cedar exec output', list.stdout, list.stderr)

        throw new Error('Scripts not included in list')
      }

      // Verify that the scripts can be executed
      const runFromRoot = await exec(
        'yarn cedar exec one/two/myNestedScript',
        [],
        getExecaOptions(OUTPUT_PROJECT_PATH),
      )

      if (!runFromRoot.stdout.includes('Hello from myNestedScript')) {
        console.error('`yarn cedar exec one/two/myNestedScript` output')
        console.error(runFromRoot.stdout, runFromRoot.stderr)

        throw new Error('Script not executed successfully')
      }

      const runFromScripts = await exec(
        'yarn cedar exec one/two/myNestedScript',
        [],
        getExecaOptions(path.join(OUTPUT_PROJECT_PATH, 'scripts', 'one')),
      )

      if (!runFromScripts.stdout.includes('Hello from myNestedScript')) {
        console.error('`yarn cedar exec one/two/myNestedScript` output')
        console.error(runFromScripts.stdout, runFromScripts.stderr)

        throw new Error('Script not executed successfully')
      }
    },
  })

  await tuiTask({
    step: 12,
    title: 'Running prisma migrate reset',
    task: () => {
      return exec(
        'yarn cedar prisma migrate reset',
        ['--force'],
        getExecaOptions(OUTPUT_PROJECT_PATH),
      )
    },
  })

  await tuiTask({
    step: 13,
    title: 'Lint --fix all the things',
    task: async () => {
      try {
        await exec('yarn', ['cedar', 'lint', '--fix'], {
          stdio: 'pipe',
          cleanup: true,
          cwd: OUTPUT_PROJECT_PATH,
          env: {
            RW_PATH: path.join(import.meta.dirname, '../../'),
          },
        })
      } catch (e) {
        if (
          e instanceof ExecaError &&
          !e.stderr &&
          e.stdout.includes('13 problems (13 errors, 0 warnings)')
        ) {
          // This is unfortunate, but linting is expected to fail.
          // This is the expected error message, so we just fall through
          // If the expected error message changes you'll have to update the
          // `includes` check above
        } else {
          // Unexpected error. Rethrow
          throw e
        }
      }
    },
  })

  await tuiTask({
    step: 14,
    title: 'Replace and Cleanup Fixture',
    task: async () => {
      // @TODO: This only works on UNIX, we should use path.join everywhere
      // remove all .gitignore
      await rimraf(`${OUTPUT_PROJECT_PATH}/.redwood/**/*`, {
        glob: {
          ignore: [
            `${OUTPUT_PROJECT_PATH}/.redwood/README.md`,
            // This is needed to not have annoying TS errors in the __fixtures__
            // test project folder
            // See packages/internal/src/generate/typeDefinitions.ts
            `${OUTPUT_PROJECT_PATH}/.redwood/types/includes/web-vite-client.d.ts`,
          ],
        },
      })
      await rimraf(`${OUTPUT_PROJECT_PATH}/api/db/dev.db`)
      await rimraf(`${OUTPUT_PROJECT_PATH}/api/db/dev.db-journal`)
      await rimraf(`${OUTPUT_PROJECT_PATH}/api/dist`)
      await rimraf(`${OUTPUT_PROJECT_PATH}/node_modules`)
      await rimraf(`${OUTPUT_PROJECT_PATH}/web/node_modules`)
      await rimraf(`${OUTPUT_PROJECT_PATH}/.env`)
      await rimraf(`${OUTPUT_PROJECT_PATH}/yarn.lock`)
      await rimraf(`${OUTPUT_PROJECT_PATH}/step.txt`)
      await rimraf(`${OUTPUT_PROJECT_PATH}/.nx`)
      await rimraf(`${OUTPUT_PROJECT_PATH}/tarballs`)

      // Copy over package.json from template, so we remove the extra dev
      // dependencies, and cfw postinstall script that we added in "Adding
      // framework dependencies to project"
      // There's one devDep we actually do want in there though, and that's the
      // prettier plugin for Tailwind CSS
      // We also want the `packages/*` workspace config that was added when
      // adding the validators package
      const rootPackageJson = JSON.parse(
        fs.readFileSync(path.join(OUTPUT_PROJECT_PATH, 'package.json'), 'utf8'),
      )
      const templateRootPackageJsonPath = path.join(
        import.meta.dirname,
        '../../packages/create-cedar-app/templates/ts/package.json',
      )
      const newRootPackageJson = JSON.parse(
        fs.readFileSync(templateRootPackageJsonPath, 'utf8'),
      )
      newRootPackageJson.devDependencies['prettier-plugin-tailwindcss'] =
        rootPackageJson.devDependencies['prettier-plugin-tailwindcss']
      newRootPackageJson.workspaces.push('packages/*')
      fs.writeFileSync(
        path.join(OUTPUT_PROJECT_PATH, 'package.json'),
        JSON.stringify(newRootPackageJson, null, 2) + '\n',
      )

      // removes existing Fixture and replaces with newly built project,
      // then removes new Project temp directory
      await copyProject()
    },
  })

  await tuiTask({
    step: 15,
    title: 'All done!',
    task: () => {
      console.log('-'.repeat(30))
      console.log()
      console.log('✅ Success! The test project fixture has been rebuilt')
      console.log()
      console.log('-'.repeat(30))
    },
    enabled: verbose,
  })

  if (localPrisma) {
    await localPrisma.close()
  }

  // overall end
  const overallEnd = Date.now()
  const overallDurationMs = overallEnd - overallStart

  // compile a summary of timings for steps and sub-steps
  const timingEntries: {
    stepId: string
    durationMs: number
    skipped?: boolean
  }[] = []

  Object.keys(stepTimings).forEach((k) => {
    const entry = stepTimings[k]
    if (entry && typeof entry.durationMs === 'number') {
      timingEntries.push({
        stepId: k,
        durationMs: entry.durationMs,
        skipped: entry.skipped,
      })
    }
  })

  // sort by stepId for nicer output
  timingEntries.sort((a, b) => {
    const aParts = a.stepId.split('.').map((s) => parseInt(s, 10))
    const bParts = b.stepId.split('.').map((s) => parseInt(s, 10))

    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
      const av = aParts[i] ?? 0
      const bv = bParts[i] ?? 0

      if (av < bv) {
        return -1
      }

      if (av > bv) {
        return 1
      }
    }

    return 0
  })

  const summary = {
    overall: {
      durationMs: overallDurationMs,
      duration: `${(overallDurationMs / 1000).toFixed(2)}s`,
      startedAt: new Date(overallStart).toISOString(),
      endedAt: new Date(overallEnd).toISOString(),
    },
    steps: timingEntries.map((t) => {
      return {
        stepId: t.stepId,
        durationMs: t.durationMs,
        duration: `${(t.durationMs / 1000).toFixed(2)}s`,
        skipped: t.skipped ?? false,
      }
    }),
  }

  console.log()
  console.log('Execution time summary:')
  console.log(JSON.stringify(summary, null, 2))
  console.log()
}

rebuildTestProject()
