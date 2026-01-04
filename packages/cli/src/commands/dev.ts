import { terminalLink } from 'termi-link'
import type { Argv } from 'yargs'

// @ts-expect-error - Types not available for JS files
import c from '../lib/colors.js'
// @ts-expect-error - Types not available for JS files
import { checkNodeVersion } from '../middleware/checkNodeVersion.js'

export const command = 'dev [workspace..]'
export const description = 'Start development servers for api, and web'

export const builder = (yargs: Argv) => {
  yargs
    .positional('workspace', {
      choices: ['api', 'web'],
      default: ['api', 'web'],
      description: 'Which dev server(s) to start',
      type: 'string',
      array: true,
    })
    .option('forward', {
      alias: 'fwd',
      description:
        'String of one or more vite dev server config options, for example: ' +
        '`--fwd="--port=1234 --open=false"`',
      type: 'string',
      // The reason `forward` is hidden is that it's been broken with Vite and
      // it's not clear how to fix it.
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
        'Port on which to expose API server debugger. If you supply the flag ' +
        'with no value it defaults to 18911.',
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

export const handler = async (options: any) => {
  const { handler } = await import('./dev/devHandler.js')
  return handler(options)
}
