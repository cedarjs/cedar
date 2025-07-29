import { terminalLink } from 'termi-link'

import { getConfig } from '@cedarjs/project-config'

import c from '../lib/colors.js'
import { checkNodeVersion } from '../middleware/checkNodeVersion.js'

export const command = 'dev [side..]'
export const description = 'Start development servers for your sides'

export const builder = (yargs) => {
  const projectConfig = getConfig()

  yargs
    .positional('side', {
      choices: ['api', 'web', ...Object.keys(projectConfig.experimental.sides)],
      default:
        projectConfig.experimental.cli.dev.defaultSides.length > 0
          ? projectConfig.experimental.cli.dev.defaultSides
          : ['api', 'web'],
      description: 'Which dev server(s) to start',
      type: 'array',
    })
    // The reason `forward` is hidden is that it's been broken with Vite
    // and it's not clear how to fix it.
    .option('forward', {
      alias: 'fwd',
      description:
        'String of one or more vite dev server config options, for example: `--fwd="--port=1234 --open=false"`',
      type: 'string',
      hidden: true,
    })
    .option('generate', {
      type: 'boolean',
      default: true,
      description: 'Generate artifacts',
    })
    .option('apiDebugPort', {
      type: 'number',
      description:
        'Port on which to expose API server debugger. If you supply the flag with no value it defaults to 18911.',
    })
    .middleware(() => {
      const check = checkNodeVersion()

      if (check.ok) {
        return
      }

      console.warn(`${c.warning('Warning')}: ${check.message}\n`)
    })
    .epilogue(
      `Also see the ${terminalLink(
        'CedarJS CLI Reference',
        'https://cedarjs.com/docs/cli-commands#dev',
      )}`,
    )
}

export const handler = async (options) => {
  const { handler } = await import('./devHandler.js')
  return handler(options)
}
