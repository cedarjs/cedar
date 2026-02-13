// inspired by gatsby/packages/gatsby-cli/src/create-cli.js and
// gridsome/packages/cli/lib/commands/info.js
import fs from 'node:fs'
import path from 'node:path'

import envinfo from 'envinfo'
import { terminalLink } from 'termi-link'
import type { Argv } from 'yargs'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'
import { getConfigPath } from '@cedarjs/project-config'

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

  const output = await envinfo.run({
    System: ['OS', 'Shell'],
    Binaries: ['Node', 'Yarn'],
    Browsers: ['Chrome', 'Edge', 'Firefox', 'Safari'],
    // yarn workspaces not supported :-/
    npmPackages: '@cedarjs/*',
    Databases: ['SQLite'],
  })

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
