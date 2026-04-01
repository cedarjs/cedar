import fs from 'node:fs'
import path from 'node:path'

import semver from 'semver'
import { terminalLink } from 'termi-link'

import { ReactiveTUIContent, RedwoodStyling } from '@cedarjs/tui'

import { shutdownTelemetry, recordErrorViaTelemetry } from './telemetry.js'
import { tui } from './tui.js'

export async function executeNodeCompatibilityCheck(templateDir: string) {
  const tuiContent = new ReactiveTUIContent({
    mode: 'text',
    content: 'Checking node compatibility',
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
