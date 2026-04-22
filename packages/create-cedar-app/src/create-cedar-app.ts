import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { trace, SpanStatusCode } from '@opentelemetry/api'
import execa from 'execa'
import gradient from 'gradient-string'
import { hideBin, Parser } from 'yargs/helpers'
import yargs from 'yargs/yargs'

import { ReactiveTUIContent, RedwoodStyling } from '@cedarjs/tui'

import pkgJson from '../package.json' with { type: 'json' }

import {
  detectPackageManagerFromEnv,
  handleCommitMessagePreference,
  handleDatabasePreference,
  handleEsmPreference,
  handleGitPreference,
  handleInstallPreference,
  handlePackageManagerPreference,
  handleTargetDirPreference,
  handleTypescriptPreference,
  INITIAL_COMMIT_MESSAGE,
} from './handle-args.js'
import type { PackageManager } from './handle-args.js'
import { executeNodeCompatibilityCheck } from './node-version.js'
import {
  getBinExecutor,
  getCedarCommandPrefix,
  getInstallCommand,
} from './package-manager.js'
import { createProjectFiles } from './project-files.js'
import {
  startTelemetry,
  shutdownTelemetry,
  recordErrorViaTelemetry,
} from './telemetry.js'
import { tui } from './tui.js'

// Telemetry can be disabled in two ways:
// - by passing `--telemetry false`  or `--no-telemetry`
// - by setting the `REDWOOD_DISABLE_TELEMETRY` env var to `1`
const { telemetry } = Parser(hideBin(process.argv), {
  boolean: ['telemetry'],
  default: {
    telemetry:
      process.env.REDWOOD_DISABLE_TELEMETRY === undefined ||
      process.env.REDWOOD_DISABLE_TELEMETRY === '',
  },
})

async function installNodeModules(
  newAppDir: string,
  packageManager: PackageManager,
) {
  const tuiContent = new ReactiveTUIContent({
    mode: 'text',
    header: `Installing node modules with ${packageManager}`,
    content: '  ⏱ This could take a while...',
    spinner: {
      enabled: true,
    },
  })
  tui.startReactive(tuiContent)

  const oldCwd = process.cwd()
  process.chdir(newAppDir)

  const installCommand = getInstallCommand(packageManager)
  const installSubprocess = execa(installCommand, {
    shell: true,
    cwd: newAppDir,
  })

  try {
    await installSubprocess
  } catch (error) {
    const prettyInstallCommand = RedwoodStyling.info(`'${installCommand}'`)
    tui.stopReactive(true)
    tui.displayError(
      "Couldn't install node modules",
      [
        `We couldn't install node modules via ${prettyInstallCommand}. ` +
          'Please see below for the full error message.',
        '',
        String(error),
      ].join('\n'),
    )
    recordErrorViaTelemetry(error)
    await shutdownTelemetry()
    process.chdir(oldCwd)
    process.exit(1)
  }

  process.chdir(oldCwd)

  tuiContent.update({
    header: '',
    content: `${RedwoodStyling.green('✔')} Installed node modules`,
    spinner: {
      enabled: false,
    },
  })
  tui.stopReactive()
}

async function generateTypes(
  newAppDir: string,
  packageManager: PackageManager,
) {
  const tuiContent = new ReactiveTUIContent({
    mode: 'text',
    content: 'Generating types',
    spinner: {
      enabled: true,
    },
  })
  tui.startReactive(tuiContent)

  const binExec = getBinExecutor(packageManager)

  try {
    await execa(binExec, ['cedar-gen'], { cwd: newAppDir })
  } catch (error) {
    const prettyGenCommand = RedwoodStyling.info(`'${binExec} cedar-gen'`)
    tui.stopReactive(true)
    tui.displayError(
      "Couldn't generate types",
      [
        `We could not generate types using ${prettyGenCommand}. Please see ` +
          'below for the full error message.',
        '',
        String(error),
      ].join('\n'),
    )
    recordErrorViaTelemetry(error)
    await shutdownTelemetry()
    process.exit(1)
  }

  tuiContent.update({
    content: `${RedwoodStyling.green('✔')} Generated types`,
    spinner: {
      enabled: false,
    },
  })
  tui.stopReactive()
}

async function initializeGit(newAppDir: string, commitMessage: string) {
  const tuiContent = new ReactiveTUIContent({
    mode: 'text',
    content: 'Initializing a git repo',
    spinner: {
      enabled: true,
    },
  })
  tui.startReactive(tuiContent)

  try {
    await execa('git', ['init'], { cwd: newAppDir })
    await execa('git', ['add', '.'], { cwd: newAppDir })
    await execa('git', ['commit', '-m', commitMessage], { cwd: newAppDir })
  } catch (error) {
    tui.stopReactive(true)
    tui.displayError(
      "Couldn't initialize a git repo",
      [
        `We could not initialize a git repo using ${RedwoodStyling.info(
          `git init && git add . && git commit -m "${commitMessage}"`,
        )}. Please see below for the full error message.`,
        '',
        String(error),
      ].join('\n'),
    )
    recordErrorViaTelemetry(error)
    await shutdownTelemetry()
    process.exit(1)
  }

  tuiContent.update({
    content: `${RedwoodStyling.green(
      '✔',
    )} Initialized a git repo with commit message "${commitMessage}"`,
    spinner: {
      enabled: false,
    },
  })
  tui.stopReactive()
}

/**
 * This function creates a new Cedar app.
 *
 * It performs the following actions:
 *  - TODO - Add a list of what this function does
 */
async function createCedarApp() {
  const cli = yargs(hideBin(process.argv))
    .scriptName(pkgJson.name)
    .usage('Usage: $0 <project directory>')
    .example([
      [
        '$0 my-cedar-app',
        'Create a new Cedar app in the "my-cedar-app" directory',
      ],
    ])
    .version(pkgJson.version)
    .option('yes', {
      alias: 'y',
      default: null,
      type: 'boolean',
      describe: 'Skip prompts and use defaults',
    })
    .option('node-check', {
      default: true,
      type: 'boolean',
      describe: 'Check if the installed version of Node is supported',
    })
    .option('overwrite', {
      default: false,
      type: 'boolean',
      describe: "Create even if target directory isn't empty",
    })
    .option('typescript', {
      alias: 'ts',
      default: null,
      type: 'boolean',
      describe: 'Generate a TypeScript project',
    })
    .option('esm', {
      hidden: true,
      default: null,
      type: 'boolean',
      describe: 'Generate an ESM project',
    })
    .option('git-init', {
      alias: 'git',
      default: null,
      type: 'boolean',
      describe: 'Initialize a git repository',
    })
    .option('commit-message', {
      alias: 'm',
      default: null,
      type: 'string',
      describe: 'Commit message for the initial commit',
    })
    .option('telemetry', {
      default: true,
      type: 'boolean',
      describe:
        'Enables sending telemetry events for this create command and all Cedar CLI commands https://telemetry.redwoodjs.com',
    })
    .option('package-manager', {
      alias: 'pm',
      default: null,
      hidden: true,
      type: 'string',
      describe: 'Package manager to use (yarn, npm, pnpm)',
    })
    .option('install', {
      // TODO(PM): Remove this alias at the same time as we remove
      // `hidden: true` from the --pm flag
      alias: 'yarn-install',
      default: null,
      type: 'boolean',
      describe: 'Install node modules. Skip via --no-install.',
    })
    .option('database', {
      alias: 'db',
      hidden: true,
      default: null,
      type: 'string',
      describe: 'Database to use (sqlite, pglite, neon-postgres)',
    })

  const parsedFlags = await cli.parse()

  // Logo generated by https://www.asciiart.eu/text-to-ascii-art using the "DOS
  // Rebel" font
  const logo2 = `

     █████████               █████                           █████  █████████
    ███░░░░░███             ░░███                           ░░███  ███░░░░░███
   ███     ░░░   ██████   ███████   ██████   ████████        ░███ ░███    ░░░
  ░███          ███░░███ ███░░███  ░░░░░███ ░░███░░███       ░███ ░░█████████
  ░███         ░███████ ░███ ░███   ███████  ░███ ░░░        ░███  ░░░░░░░░███
  ░░███     ███░███░░░  ░███ ░███  ███░░███  ░███      ███   ░███  ███    ░███
   ░░█████████ ░░██████ ░░████████░░████████ █████    ░░████████  ░░█████████
    ░░░░░░░░░   ░░░░░░   ░░░░░░░░  ░░░░░░░░ ░░░░░      ░░░░░░░░    ░░░░░░░░░

`

  console.log(gradient(['#00ff41', '#008f11']).multiline(logo2))

  const detectedPm = detectPackageManagerFromEnv()

  // Extract the args as provided by the user in the command line
  const args = parsedFlags._
  const packageManagerFlag =
    parsedFlags['package-manager'] ??
    (parsedFlags.yes ? (detectedPm ?? 'yarn') : null)
  const installFlag = parsedFlags.install ?? (parsedFlags.yes ? true : null)
  const typescriptFlag = parsedFlags.typescript ?? parsedFlags.yes
  const esmFlag = parsedFlags.esm // TODO: ?? parsedFlags.yes
  const overwriteFlag = parsedFlags.overwrite
  const databaseFlag = parsedFlags.database ?? null
  const gitInitFlag = parsedFlags['git-init'] ?? parsedFlags.yes
  const commitMessageFlag =
    parsedFlags['commit-message'] ??
    (parsedFlags.yes ? INITIAL_COMMIT_MESSAGE : null)

  // Record some of the arguments for telemetry
  trace.getActiveSpan()?.setAttribute('install', installFlag ?? false)
  trace.getActiveSpan()?.setAttribute('overwrite', overwriteFlag)

  // Get the directory for installation from the args
  let targetDir = String(args).replace(/,/g, '-')

  const templatesDir = fileURLToPath(new URL('../templates', import.meta.url))

  // Node version check
  const nodeCheck = parsedFlags['node-check']
  if (nodeCheck) {
    await executeNodeCompatibilityCheck(path.join(templatesDir, 'ts'))
  } else {
    tui.drawText(`${RedwoodStyling.info('ℹ')} Skipped node version check`)
  }
  trace.getActiveSpan()?.setAttribute('node-check', nodeCheck)

  targetDir = await handleTargetDirPreference(targetDir)

  // Determine ts/js preference
  const useTypescript = await handleTypescriptPreference(typescriptFlag)
  trace.getActiveSpan()?.setAttribute('typescript', useTypescript)

  // Determine ESM or not
  const useEsm = await handleEsmPreference(esmFlag)
  trace.getActiveSpan()?.setAttribute('esm', useEsm)

  const database = await handleDatabasePreference(databaseFlag, useEsm)
  trace.getActiveSpan()?.setAttribute('database', database)

  // Determine package manager preference
  const packageManager = await handlePackageManagerPreference(
    // TODO(PM): Remove `|| 'yarn'` once we're ready to remove `hidden: true`
    // from the flag
    packageManagerFlag || 'yarn',
  )
  trace.getActiveSpan()?.setAttribute('package-manager', packageManager)

  const templateDir = path.join(
    templatesDir,
    useTypescript ? (useEsm ? 'esm-ts' : 'ts') : useEsm ? 'esm-js' : 'js',
  )
  // Determine git preference
  const useGit = await handleGitPreference(gitInitFlag)
  trace.getActiveSpan()?.setAttribute('git', useGit)

  let commitMessage: string | undefined
  if (useGit) {
    commitMessage = await handleCommitMessagePreference(commitMessageFlag)
  }

  // Determine install preference
  const shouldInstall = await handleInstallPreference(
    installFlag,
    packageManager,
  )

  let newAppDir = path.resolve(process.cwd(), targetDir)

  // Create project files
  // if this directory already exists then createProjectFiles may set a new
  // directory name
  newAppDir = await createProjectFiles(newAppDir, {
    templateDir,
    templatesDir,
    overwrite: overwriteFlag,
    packageManager,
    useEsm,
    database,
  })

  const installCommand = getInstallCommand(packageManager)

  // Install the node packages
  if (shouldInstall) {
    const installStart = Date.now()
    await installNodeModules(newAppDir, packageManager)
    trace
      .getActiveSpan()
      ?.setAttribute('install-time', Date.now() - installStart)
  } else {
    tui.drawText(`${RedwoodStyling.info('ℹ')} Skipped ${installCommand} step`)
  }

  // Generate types
  if (shouldInstall) {
    await generateTypes(newAppDir, packageManager)
  }

  // Initialize git repo
  if (useGit) {
    await initializeGit(newAppDir, commitMessage!)
  }

  const shouldPrintCdCommand = newAppDir !== process.cwd()
  const newAppPath = newAppDir.startsWith(process.cwd() + path.sep)
    ? path.relative(process.cwd(), newAppDir)
    : newAppDir
  const cedarCommand = getCedarCommandPrefix(packageManager)

  // Post install message
  tui.drawText(
    [
      '',
      RedwoodStyling.success('Thanks for trying out CedarJS!'),
      '',
      ` ⚡️ ${RedwoodStyling.redwood(
        'Get up and running fast with this Quick Start guide',
      )}: https://cedarjs.com/docs/quick-start`,
      '',
      `${RedwoodStyling.header(`Fire it up!`)} 🚀`,
      '',
      ...[
        shouldPrintCdCommand &&
          `${RedwoodStyling.redwood(
            ` > ${RedwoodStyling.green(`cd ${newAppPath}`)}`,
          )}`,
        !shouldInstall &&
          `${RedwoodStyling.redwood(
            ` > ${RedwoodStyling.green(installCommand)}`,
          )}`,
        `${RedwoodStyling.redwood(
          ` > ${RedwoodStyling.green(cedarCommand + ' dev')}`,
        )}`,
      ].filter(Boolean),
      '',
    ].join('\n'),
  )
}

if (telemetry) {
  try {
    await startTelemetry()
  } catch (error) {
    console.error('Telemetry startup error')
    console.error(error)
  }
}

// Execute create cedar app within a span
const tracer = trace.getTracer('redwoodjs')
await tracer.startActiveSpan('create-cedar-app', async (span) => {
  await createCedarApp()

  // Span housekeeping
  span?.setStatus({ code: SpanStatusCode.OK })
  span?.end()
})

// Shutdown telemetry, ensures data is sent before the process exits
try {
  await shutdownTelemetry()
} catch (error) {
  console.error('Telemetry shutdown error')
  console.error(error)
}
