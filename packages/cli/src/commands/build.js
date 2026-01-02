import { terminalLink } from 'termi-link'

import c from '../lib/colors.js'
import { exitWithError } from '../lib/exit.js'
import { workspaces } from '../lib/project.js'
import { checkNodeVersion } from '../middleware/checkNodeVersion.js'

export const command = 'build [workspace..]'
export const description = 'Build for production'

export const builder = (yargs) => {
  yargs
    .positional('workspace', {
      default: ['web', 'api', 'packages/*'],
      description:
        'What workspace(s) to build. Valid values are: web, api, packages/*, ' +
        '<package-name>',
      type: 'array',
    })
    .option('verbose', {
      alias: 'v',
      default: false,
      description: 'Print more',
      type: 'boolean',
    })
    .option('prerender', {
      default: true,
      description: 'Prerender after building web',
      type: 'boolean',
    })
    .option('prisma', {
      type: 'boolean',
      alias: 'db',
      default: true,
      description: 'Generate the Prisma client',
    })
    .middleware(() => {
      const check = checkNodeVersion()

      if (check.ok) {
        return
      }

      exitWithError(undefined, {
        message: `${c.error('Error')}: ${check.message}`,
        includeEpilogue: false,
      })
    })
    .check((argv) => {
      const workspacesArg = argv.workspace

      if (!Array.isArray(workspacesArg)) {
        return 'Workspace must be an array'
      }

      // Remove all default workspace names and then check if there are any
      // remaining workspaces to build. This is an optimization to avoid calling
      // `workspaces({ includePackages: true }) as that's a somewhat expensive
      // method call that hits the filesystem and parses files

      const filtered = workspacesArg.filter(
        (item) => item !== 'api' && item !== 'web' && item !== 'packages/*',
      )

      if (filtered.length === 0) {
        return true
      }

      const workspaceNames = workspaces({ includePackages: true })

      if (!workspacesArg.every((item) => workspaceNames.includes(item))) {
        return (
          c.error(`Unknown workspace ${workspacesArg.join(' ')}`) +
          '\n\nValid values are: ' +
          workspaceNames.join(', ')
        )
      }

      return true
    })
    .epilogue(
      `Also see the ${terminalLink(
        'CedarJS CLI Reference',
        'https://cedarjs.com/docs/cli-commands#build',
      )}`,
    )
}

export const handler = async (options) => {
  const { handler } = await import('./buildHandler.js')
  return handler(options)
}
