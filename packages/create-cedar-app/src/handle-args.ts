import untildify from 'untildify'

import { RedwoodTUI, RedwoodStyling } from '@cedarjs/tui'

import { shutdownTelemetry, recordErrorViaTelemetry } from './telemetry.js'

export type PackageManager = 'yarn' | 'npm' | 'pnpm'

export const INITIAL_COMMIT_MESSAGE = 'Initial commit'

const tui = new RedwoodTUI()

export async function handleTargetDirPreference(targetDir: string) {
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

export async function handleTypescriptPreference(
  typescriptFlag: boolean | null,
) {
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

export async function handleEsmPreference(esmFlag: boolean | null) {
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

export async function handleGitPreference(gitInitFlag: boolean | null) {
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

export async function handleNewDirectoryNamePreference() {
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

export async function handleCommitMessagePreference(
  commitMessageFlag: string | null,
) {
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

export async function handleInstallPreference(
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

function isPackageManager(value: string | null): value is PackageManager {
  return ['yarn', 'npm', 'pnpm'].includes(value ?? '')
}

export function detectPackageManagerFromEnv() {
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

export async function handlePackageManagerPreference(
  packageManagerFlag: string | null,
) {
  // Handle case where flag is set
  if (isPackageManager(packageManagerFlag)) {
    tui.drawText(
      `${RedwoodStyling.green('✔')} Using ${packageManagerFlag} based on command line flag`,
    )
    return packageManagerFlag
  }

  // Prompt user for preference
  try {
    const detectedPm = detectPackageManagerFromEnv()
    const response = await tui.prompt<{ packageManager: PackageManager }>({
      type: 'Select',
      name: 'packageManager',
      choices: ['yarn', 'npm', 'pnpm'],
      message: 'Select your preferred package manager',
      initial: detectedPm,
    } as Parameters<typeof tui.prompt>[0])
    return response.packageManager
  } catch {
    recordErrorViaTelemetry('User cancelled install at package manager prompt')
    await shutdownTelemetry()
    process.exit(1)
  }
}
