// inspired by gatsby/packages/gatsby-cli/src/create-cli.js and
// gridsome/packages/cli/lib/commands/info.js
import fs from 'node:fs'
import path from 'node:path'

import envinfo from 'envinfo'
import { terminalLink } from 'termi-link'
import type { Argv } from 'yargs'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers/telemetry'
import { getConfigPath } from '@cedarjs/project-config'
import {
  getOsName,
  getPackageManager,
  getShellPath,
} from '@cedarjs/telemetry/systemInfo'

export const command = 'info'
export const description = 'Print your system environment information'
export const builder = (yargs: Argv) => {
  yargs.epilogue(
    `Also see the ${terminalLink(
      'CedarJS CLI Reference',
      'https://cedarjs.com/docs/cli-commands#info',
    )}`,
  )
}
export const handler = async () => {
  recordTelemetryAttributes({ command: 'info' })

  const envinfoOutput = await envinfo.run({
    Browsers: ['Chrome', 'Edge', 'Firefox', 'Safari'],
    // yarn workspaces not supported :-/
    npmPackages: '@cedarjs/*',
    Databases: ['SQLite'],
  })

  // System and Binaries come from the same lookups telemetry uses, so this
  // output shows the values telemetry reports
  const packageManager = getPackageManager()
  const sections =
    formatSection('System', { OS: getOsName(), Shell: getShellPath() }) +
    formatSection('Binaries', {
      Node: `${process.versions.node} - ${process.execPath}`,
      ...(packageManager && {
        [packageManagerLabel(packageManager.name)]: packageManager.version,
      }),
    })

  // Like envinfo's, the output starts with an empty line. envinfo's own
  // sections continue the ones above
  const output = '\n' + sections + envinfoOutput.replace(/^\n/, '')

  const configTomlPath = getConfigPath()
  const tomlContent = fs.readFileSync(configTomlPath, 'utf8')

  console.log(
    output +
      `  ${path.basename(configTomlPath)}:\n` +
      tomlContent
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .filter((line) => !line.startsWith('#'))
        .map((line) => `    ${line}`)
        .join('\n'),
  )
}

/** How envinfo names package managers, like `Yarn` or `npm` */
function packageManagerLabel(name: string) {
  const labels: Record<string, string> = { yarn: 'Yarn', bun: 'Bun' }

  return labels[name] ?? name
}

/**
 * Formats a section the same way envinfo does, leaving out anything that
 * wasn't found
 */
function formatSection(
  title: string,
  entries: Record<string, string | undefined>,
) {
  const lines = Object.entries(entries).flatMap(([name, value]) =>
    value ? [`    ${name}: ${value}`] : [],
  )

  if (lines.length === 0) {
    return ''
  }

  return `  ${title}:\n${lines.join('\n')}\n`
}
