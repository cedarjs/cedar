import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { trace, SpanStatusCode } from '@opentelemetry/api'
import execa from 'execa'
import gradient from 'gradient-string'
import semver from 'semver'
import { terminalLink } from 'termi-link'
import untildify from 'untildify'
import { hideBin, Parser } from 'yargs/helpers'
import yargs from 'yargs/yargs'

import { RedwoodTUI, ReactiveTUIContent, RedwoodStyling } from '@cedarjs/tui'

import pkgJson from '../package.json' with { type: 'json' }

import {
  UID,
  startTelemetry,
  shutdownTelemetry,
  recordErrorViaTelemetry,
} from './telemetry.js'

const INITIAL_COMMIT_MESSAGE = 'Initial commit'

type PackageManager = 'yarn' | 'npm' | 'pnpm'

function detectPackageManagerFromEnv() {
  const userAgent = process.env.npm_config_user_agent
  const envPackageManager = userAgent?.split(' ')[0]?.split('/')[0]

  if (
    envPackageManager === 'yarn' ||
    envPackageManager === 'npm' ||
    envPackageManager === 'pnpm'
  ) {
    return envPackageManager
  }

  return undefined
}

function getInstallCommand(pm: PackageManager) {
  return `${pm} install`
}

function getCedarCommandPrefix(pm: PackageManager) {
  if (pm === 'npm') {
    return 'npx cedar'
  } else if (pm === 'pnpm') {
    return 'pnpm exec cedar'
  }

  return 'yarn cedar'
}

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

const tui = new RedwoodTUI()

async function executeNodeCompatibilityCheck(templateDir: string) {
  const tuiContent = new ReactiveTUIContent({
    mode: 'text',
    content: `Checking node compatibility`,
    spinner: {
      enabled: true,
    },
  })
  tui.startReactive(tuiContent)

  const { isSatisfied, nodeRange } = checkNodeVersion(templateDir)

  if (isSatisfied) {
    tuiContent.update({
      spinner: {
        enabled: false,
      },
      content: `${RedwoodStyling.green('✔')} Compatibility checks passed`,
    })
    tui.stopReactive()

    return
  }

  const minRequired = semver.minVersion(nodeRange)
  const nodeVersionIsTooOld =
    minRequired && semver.lt(process.version, minRequired)

  if (nodeVersionIsTooOld) {
    tui.stopReactive(true)
    tui.displayError(
      'Compatibility checks failed',
      [
        `  You need to upgrade the version of node you're using.`,
        `  You're using ${process.version} and we currently support node ${nodeRange}.`,
        '',
        `  Please use tools like nvm or corepack to change to a compatible version.`,
        `  See: ${terminalLink(
          'How to - Using nvm',
          'https://cedarjs.com/docs/how-to/using-nvm',
          {
            fallback: () =>
              'How to - Using nvm https://cedarjs.com/docs/how-to/using-nvm',
          },
        )}`,
        `  See: ${terminalLink(
          'Tutorial - Prerequisites',
          'https://cedarjs.com/docs/tutorial/chapter1/prerequisites',
          {
            fallback: () =>
              'Tutorial - Prerequisites https://cedarjs.com/docs/tutorial/chapter1/prerequisites',
          },
        )}`,
      ].join('\n'),
    )

    recordErrorViaTelemetry('Compatibility checks failed')
    await shutdownTelemetry()
    process.exit(1)
  }

  tui.stopReactive(true)
  tui.displayWarning(
    'Compatibility checks failed',
    [
      `  You may want to downgrade the version of node you're using.`,
      `  You're using ${process.version} and we currently support node ${nodeRange}.`,
      '',
      `  This may make your project incompatible with some deploy targets, especially those using AWS Lambdas.`,
      '',
      `  Please use tools like nvm or corepack to change to a compatible version.`,
      `  See: ${terminalLink(
        'How to - Use nvm',
        'https://cedarjs.com/docs/how-to/using-nvm',
        {
          fallback: () =>
            'How to - Use nvm https://cedarjs.com/docs/how-to/using-nvm',
        },
      )}`,
      `  See: ${terminalLink(
        'Tutorial - Prerequisites',
        'https://cedarjs.com/docs/tutorial/chapter1/prerequisites',
        {
          fallback: () =>
            'Tutorial - Prerequisites https://cedarjs.com/docs/tutorial/chapter1/prerequisites',
        },
      )}`,
    ].join('\n'),
  )

  // Try catch for handling if the user cancels the prompt.
  try {
    const response = await tui.prompt<{ 'override-engine-error': string }>({
      type: 'select',
      name: 'override-engine-error',
      message: 'How would you like to proceed?',
      choices: ['Override error and continue install', 'Quit install'],
      initial: 0,
    })
    if (response['override-engine-error'] === 'Quit install') {
      recordErrorViaTelemetry('User quit after engine check error')
      await shutdownTelemetry()
      process.exit(0)
    }
  } catch {
    recordErrorViaTelemetry('User cancelled install at engine check error')
    await shutdownTelemetry()
    process.exit(1)
  }
}

function checkNodeVersion(templateDir: string) {
  const templatePackageJson = JSON.parse(
    fs.readFileSync(path.join(templateDir, 'package.json'), 'utf-8'),
  )

  const nodeRange = templatePackageJson?.engines?.node

  if (typeof nodeRange !== 'string') {
    throw new Error('Invalid node engine version range in package.json')
  }

  const isSatisfied = semver.satisfies(process.version, nodeRange)
  return { isSatisfied, nodeRange }
}

interface CreateProjectFilesOptions {
  templateDir: string
  overwrite: boolean
  packageManager: PackageManager
}

async function createProjectFiles(
  appDir: string,
  { templateDir, overwrite, packageManager }: CreateProjectFilesOptions,
) {
  let newAppDir = appDir
  const templatePmDir = path.join(templateDir, packageManager)

  const tuiContent = new ReactiveTUIContent({
    mode: 'text',
    content: 'Creating project files',
    spinner: {
      enabled: true,
    },
  })
  tui.startReactive(tuiContent)

  newAppDir = await doesDirectoryAlreadyExist(newAppDir, { overwrite })

  // Ensure the new app directory exists
  fs.mkdirSync(path.dirname(newAppDir), { recursive: true })

  // Copy the template files to the new app directory
  // Have to use fs.promises.cp here because of a bug in yarn
  // See https://github.com/yarnpkg/berry/issues/6488
  await fs.promises.cp(templateDir, newAppDir, {
    recursive: true,
    force: overwrite,
  })
  await fs.promises.cp(templatePmDir, newAppDir, {
    recursive: true,
    force: overwrite,
  })

  // .gitignore is renamed here to force file inclusion during publishing
  fs.renameSync(
    path.join(newAppDir, 'gitignore.template'),
    path.join(newAppDir, '.gitignore'),
  )

  // Replace placeholders in template files
  await replacePlaceholders(newAppDir, packageManager)

  // Write the uid
  fs.mkdirSync(path.join(newAppDir, '.redwood'), { recursive: true })
  fs.writeFileSync(path.join(newAppDir, '.redwood', 'telemetry.txt'), UID)

  tuiContent.update({
    spinner: {
      enabled: false,
    },
    content: `${RedwoodStyling.green('✔')} Project files created`,
  })
  tui.stopReactive()

  return newAppDir
}

async function replacePlaceholders(
  dir: string,
  packageManager: PackageManager,
) {
  const installCommand = getInstallCommand(packageManager)
  const cedarCommand = getCedarCommandPrefix(packageManager)

  const replacements: Record<string, string> = {
    '{{PM}}': packageManager,
    '{{PM_INSTALL}}': installCommand,
    '{{CEDAR_CLI}}': cedarCommand,
  }

  async function walk(dir: string) {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        await walk(fullPath)
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name)
        // Only process text files
        if (
          ['.json', '.md', '.js', '.ts', '.yml', '.yaml', '.txt'].includes(ext)
        ) {
          let content = await fs.promises.readFile(fullPath, 'utf-8')

          for (const [placeholder, value] of Object.entries(replacements)) {
            content = content.replaceAll(placeholder, value)
          }

          await fs.promises.writeFile(fullPath, content, 'utf-8')
        }
      }
    }
  }

  await walk(dir)
}

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
    tui.stopReactive(true)
    tui.displayError(
      "Couldn't install node modules",
      [
        `We couldn't install node modules via ${RedwoodStyling.info(
          `'${installCommand}'`,
        )}. Please see below for the full error message.`,
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

  const cedarCommand = getCedarCommandPrefix(packageManager)
  const generateSubprocess = execa(`${cedarCommand} rw-gen`, {
    shell: true,
    cwd: newAppDir,
  })

  try {
    await generateSubprocess
  } catch (error) {
    tui.stopReactive(true)
    tui.displayError(
      "Couldn't generate types",
      [
        `We could not generate types using ${RedwoodStyling.info(
          `'${cedarCommand} rw-gen'`,
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

  const gitSubprocess = execa(
    `git init && git add . && git commit -m "${commitMessage}"`,
    { shell: true, cwd: newAppDir },
  )

  try {
    await gitSubprocess
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

async function handleTargetDirPreference(targetDir: string) {
  if (targetDir) {
    const targetDirText =
      targetDir === '.' ? 'the current directory' : targetDir

    tui.drawText(
      `${RedwoodStyling.green('✔')} Creating your Cedar app in ` +
        `${targetDirText} based on command line argument`,
    )

    return targetDir
  }

  // Prompt user for preference
  try {
    const response = await tui.prompt<{ targetDir: string }>({
      type: 'input',
      name: 'targetDir',
      message: 'Where would you like to create your CedarJS app?',
      initial: 'my-cedar-app',
    })

    if (/^~\w/.test(response.targetDir)) {
      tui.stopReactive(true)
      tui.displayError(
        'The `~username` syntax is not supported here',
        'Please use the full path or specify the target directory on the command line.',
      )

      recordErrorViaTelemetry('Target dir prompt path syntax not supported')
      await shutdownTelemetry()
      process.exit(1)
    }

    return untildify(response.targetDir)
  } catch {
    recordErrorViaTelemetry('User cancelled install at target dir prompt')
    await shutdownTelemetry()
    process.exit(1)
  }
}

async function handleTypescriptPreference(typescriptFlag: boolean | null) {
  // Handle case where flag is set
  if (typescriptFlag !== null) {
    tui.drawText(
      `${RedwoodStyling.green('✔')} Using ${
        typescriptFlag ? 'TypeScript' : 'JavaScript'
      } based on command line flag`,
    )
    return typescriptFlag
  }

  // Prompt user for preference
  try {
    const response = await tui.prompt<{ language: string }>({
      type: 'Select',
      name: 'language',
      choices: ['TypeScript', 'JavaScript'],
      message: 'Select your preferred language',
      initial: 'TypeScript',
      // Have to type cast here because the type of the `choices` property is
      // not inferred correctly. I could (should) fix this by updating the type
      // definition for `tui.prompt`, but I want to get rid of RwTUI, so I'm not
      // going to spend time on fixing the types now.
    } as Parameters<typeof tui.prompt>[0])
    return response.language === 'TypeScript'
  } catch {
    recordErrorViaTelemetry('User cancelled install at language prompt')
    await shutdownTelemetry()
    process.exit(1)
  }
}

async function handleEsmPreference(esmFlag: boolean | null) {
  // Handle case where flag is set
  if (esmFlag !== null) {
    tui.drawText(
      `${RedwoodStyling.green('✔')} Setting up ${
        esmFlag ? 'an ESM' : 'a CJS'
      } project based on command line flag`,
    )
    return esmFlag
  }

  return false
  // Disable this for now, while the ESM flag is hidden
  // Prompt user for preference
  // try {
  //   const response = await tui.prompt({
  //     type: 'Select',
  //     name: 'esm',
  //     choices: ['CJS', 'ESM'],
  //     message: 'Select your preferred project type',
  //     initial: 'CJS',
  //   })
  //   return response.esm === 'ESM'
  // } catch (_error) {
  //   recordErrorViaTelemetry('User cancelled install at esm prompt')
  //   await shutdownTelemetry()
  //   process.exit(1)
  // }
}

async function handleGitPreference(gitInitFlag: boolean | null) {
  // Handle case where flag is set
  if (gitInitFlag !== null) {
    tui.drawText(
      `${RedwoodStyling.green('✔')} ${
        gitInitFlag ? 'Will' : 'Will not'
      } initialize a git repo based on command line flag`,
    )
    return gitInitFlag
  }

  // Prompt user for preference
  try {
    const response = await tui.prompt<{ git: boolean }>({
      type: 'Toggle',
      name: 'git',
      message: 'Do you want to initialize a git repo?',
      enabled: 'Yes',
      disabled: 'no',
      initial: 'Yes',
    })
    return response.git
  } catch {
    recordErrorViaTelemetry('User cancelled install at git prompt')
    await shutdownTelemetry()
    process.exit(1)
  }
}

async function doesDirectoryAlreadyExist(
  appDir: string,
  {
    overwrite,
    suppressWarning,
  }: { overwrite: boolean; suppressWarning?: boolean },
) {
  let newAppDir = appDir

  // Check if the new app directory already exists
  if (fs.existsSync(newAppDir) && !overwrite) {
    // Check if the directory contains files and show an error if it does
    if (fs.readdirSync(newAppDir).length > 0) {
      const styledAppDir = RedwoodStyling.info(newAppDir)

      if (!suppressWarning) {
        tui.stopReactive(true)
        tui.displayWarning(
          'Project directory already contains files',
          [`'${styledAppDir}' already exists and is not empty`].join('\n'),
        )
      }

      try {
        const response = await tui.prompt<{
          projectDirectoryAlreadyExists: string
        }>({
          type: 'select',
          name: 'projectDirectoryAlreadyExists',
          message: 'How would you like to proceed?',
          choices: [
            'Quit install',
            `Overwrite files in '${styledAppDir}' and continue install`,
            'Specify a different directory',
          ],
          initial: 0,
        })

        // overwrite the existing files
        if (
          response.projectDirectoryAlreadyExists ===
          `Overwrite files in '${styledAppDir}' and continue install`
        ) {
          // blow away the existing directory and create a new one
          await fs.promises.rm(newAppDir, { recursive: true, force: true })
        } // specify a different directory
        else if (
          response.projectDirectoryAlreadyExists ===
          'Specify a different directory'
        ) {
          const newDirectoryName = await handleNewDirectoryNamePreference()

          if (/^~\w/.test(newDirectoryName)) {
            tui.stopReactive(true)
            tui.displayError(
              'The `~username` syntax is not supported here',
              'Please use the full path or specify the target directory on the command line.',
            )

            // Calling doesDirectoryAlreadyExist again with the same old
            // appDir as a way to prompt the user for a new directory name
            // after displaying the error above
            newAppDir = await doesDirectoryAlreadyExist(appDir, {
              overwrite,
              suppressWarning: true,
            })
          } else {
            newAppDir = path.resolve(process.cwd(), untildify(newDirectoryName))
          }

          // check to see if the new directory exists
          newAppDir = await doesDirectoryAlreadyExist(newAppDir, { overwrite })
        } // Quit Install and Throw and Error
        else if (response.projectDirectoryAlreadyExists === 'Quit install') {
          // quit and throw an error
          recordErrorViaTelemetry(
            'User quit after directory already exists error',
          )
          await shutdownTelemetry()
          process.exit(1)
        }
        // overwrite the existing files
      } catch {
        recordErrorViaTelemetry(
          `User cancelled install after directory already exists error`,
        )
        await shutdownTelemetry()
        process.exit(1)
      }
    }
  }

  return newAppDir
}

async function handleNewDirectoryNamePreference() {
  try {
    const response = await tui.prompt<{ targetDirectoryInput: string }>({
      type: 'input',
      name: 'targetDirectoryInput',
      message: 'What directory would you like to create the app in?',
      initial: 'my-cedar-app',
    })
    return response.targetDirectoryInput
  } catch {
    recordErrorViaTelemetry(
      'User cancelled install at specify a different directory prompt',
    )
    await shutdownTelemetry()
    process.exit(1)
  }
}

async function handleCommitMessagePreference(commitMessageFlag: string | null) {
  // Handle case where flag is set
  if (commitMessageFlag !== null) {
    return commitMessageFlag
  }

  // Prompt user for preference
  try {
    const response = await tui.prompt<{ commitMessage: string }>({
      type: 'input',
      name: 'commitMessage',
      message: 'Enter a commit message',
      initial: INITIAL_COMMIT_MESSAGE,
    })
    return response.commitMessage
  } catch {
    recordErrorViaTelemetry('User cancelled install at commit message prompt')
    await shutdownTelemetry()
    process.exit(1)
  }
}

async function handleInstallPreference(
  installFlag: boolean | null,
  packageManager: PackageManager,
) {
  // Handle case where flag is set
  if (installFlag !== null) {
    tui.drawText(
      `${RedwoodStyling.green('✔')} ${
        installFlag ? 'Will' : 'Will not'
      } run ${packageManager} install based on command line flag`,
    )
    return installFlag
  }

  // Prompt user for preference
  try {
    const response = await tui.prompt<{ install: boolean }>({
      type: 'Toggle',
      name: 'install',
      message: `Do you want to run ${packageManager} install?`,
      enabled: 'Yes',
      disabled: 'no',
      initial: 'Yes',
    })
    return response.install
  } catch {
    recordErrorViaTelemetry('User cancelled install at install prompt')
    await shutdownTelemetry()
    process.exit(1)
  }
}

async function handlePackageManagerPreference(
  packageManagerFlag: string | null | undefined,
): Promise<PackageManager> {
  // Handle case where flag is set
  if (packageManagerFlag) {
    tui.drawText(
      `${RedwoodStyling.green('✔')} Using ${packageManagerFlag} based on command line flag`,
    )
    return packageManagerFlag as PackageManager
  }

  // // Auto-detect in non-interactive mode (CI, piped stdin, etc.)
  // const isInteractive = process.stdin.isTTY
  // if (!isInteractive) {
  //   const detectedPm = detectPackageManagerFromEnv()
  //   tui.drawText(
  //     `${RedwoodStyling.green('✔')} Detected ${detectedPm} from environment`,
  //   )
  //   return detectedPm
  // }

  // Prompt user for preference
  try {
    const detectedPm = detectPackageManagerFromEnv()
    const response = await tui.prompt<{ packageManager: string }>({
      type: 'Select',
      name: 'packageManager',
      choices: ['yarn', 'npm', 'pnpm'],
      message: 'Select your preferred package manager',
      initial: detectedPm,
    } as Parameters<typeof tui.prompt>[0])
    return response.packageManager as PackageManager
  } catch {
    recordErrorViaTelemetry('User cancelled install at package manager prompt')
    await shutdownTelemetry()
    process.exit(1)
  }
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
      type: 'string',
      describe: 'Package manager to use (yarn, npm, pnpm)',
    })
    .option('install', {
      default: null,
      type: 'boolean',
      describe: 'Install node modules. Skip via --no-install.',
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
  // TODO: Make all flags have the 'flag' suffix
  const args = parsedFlags._
  const packageManagerFlag =
    parsedFlags['package-manager'] ?? (parsedFlags.yes ? detectedPm : null)
  const installFlag = parsedFlags.install ?? (parsedFlags.yes ? true : null)
  const typescriptFlag = parsedFlags.typescript ?? parsedFlags.yes
  const esmFlag = parsedFlags.esm // TODO: ?? parsedFlags.yes
  const overwrite = parsedFlags.overwrite
  const gitInitFlag = parsedFlags['git-init'] ?? parsedFlags.yes
  const commitMessageFlag =
    parsedFlags['commit-message'] ??
    (parsedFlags.yes ? INITIAL_COMMIT_MESSAGE : null)

  // Record some of the arguments for telemetry
  trace.getActiveSpan()?.setAttribute('install', installFlag ?? false)
  trace.getActiveSpan()?.setAttribute('overwrite', overwrite)

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

  // Determine package manager preference
  const packageManager =
    await handlePackageManagerPreference(packageManagerFlag)
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
    overwrite,
    packageManager,
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
            ` > ${RedwoodStyling.green(
              `cd ${path.relative(process.cwd(), newAppDir)}`,
            )}`,
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
