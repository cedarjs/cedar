import { terminalLink } from 'termi-link'
import type { Argv } from 'yargs'

// @ts-expect-error - Types not available for JS files
import c from '../lib/colors.js'
// @ts-expect-error - Types not available for JS files
import { workspaces } from '../lib/project.js'
// @ts-expect-error - Types not available for JS files
import { checkNodeVersion } from '../middleware/checkNodeVersion.js'

export const command = 'dev [workspace..]'
export const description =
  'Start development servers for api, web, and packages'

export const builder = (yargs: Argv) => {
  yargs
    .positional('workspace', {
      default: ['api', 'web', 'packages/*'],
      description:
        'Which dev server(s) to start. Valid values: api, web, packages/*, ' +
        '<package-name>',
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
    .check((argv) => {
      const workspaceArg = argv.workspace

      if (!Array.isArray(workspaceArg)) {
        return 'Workspace must be an array'
      }

      // Remove all default workspace names and then check if there are any
      // remaining workspaces to validate. This is an optimization to avoid
      // calling `workspaces({ includePackages: true })` as that's a somewhat
      // expensive method call that hits the filesystem and parses files

      const filtered = workspaceArg.filter(
        (item) => item !== 'api' && item !== 'web' && item !== 'packages/*',
      )

      if (filtered.length === 0) {
        return true
      }

      const workspaceNames = workspaces({ includePackages: true })

      if (!filtered.every((item) => workspaceNames.includes(item))) {
        return (
          c.error(`Unknown workspace(s) ${filtered.join(' ')}`) +
          '\n\nValid values are: ' +
          workspaceNames.join(', ')
        )
      }

      return true
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
