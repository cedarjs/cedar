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
  getNodeInfo,
  getOsName,
  getShellInfo,
  getYarnInfo,
} from '@cedarjs/telemetry/systemInfo'
import type { ToolInfo } from '@cedarjs/telemetry/systemInfo'

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

  // System and Binaries come from the same lookups telemetry uses, so this
  // output shows the values telemetry reports
  const [osName, shell, node, yarn, envinfoOutput] = await Promise.all([
    getOsName(),
    getShellInfo(),
    getNodeInfo(),
    getYarnInfo(),
    envinfo.run({
      Browsers: ['Chrome', 'Edge', 'Firefox', 'Safari'],
      // yarn workspaces not supported :-/
      npmPackages: '@cedarjs/*',
      Databases: ['SQLite'],
    }),
  ])

  const sections =
    formatSection('System', { OS: osName, Shell: shell }) +
    formatSection('Binaries', { Node: node, Yarn: yarn })

  // Like envinfo's, the output starts with an empty line. envinfo's own
  // sections continue the ones above
  const output = sections
    ? '\n' + sections + envinfoOutput.replace(/^\n/, '')
    : envinfoOutput

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

/**
 * Formats a section the same way envinfo does, leaving out anything that
 * wasn't found
 */
function formatSection(
  title: string,
  entries: Record<string, string | ToolInfo | undefined>,
) {
  const lines = Object.entries(entries).flatMap(([name, value]) => {
    if (!value) {
      return []
    }

    if (typeof value === 'string') {
      return [`    ${name}: ${value}`]
    }

    return [
      `    ${name}: ${value.version}` + (value.path ? ` - ${value.path}` : ''),
    ]
  })

  if (lines.length === 0) {
    return ''
  }

  return `  ${title}:\n${lines.join('\n')}\n`
}
