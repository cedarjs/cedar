import { terminalLink } from 'termi-link'
import type { Argv } from 'yargs'

import { colors as c } from '@cedarjs/cli-helpers'

// @ts-expect-error - Types not available for JS files
import { exitWithError } from '../lib/exit.js'
// @ts-expect-error - Types not available for JS files
import { workspaces } from '../lib/project.js'
// @ts-expect-error - Types not available for JS files
import { checkNodeVersion } from '../middleware/checkNodeVersion.js'

export const command = 'build [workspace..]'
export const description = 'Build for production'

type BuildArgv = {
  workspace?: string[]
  [key: string]: unknown
}

export const builder = (yargs: Argv) => {
  yargs
    .positional('workspace', {
      default: ['api', 'web', 'packages/*'],
      description:
        'What workspace(s) to build. Valid values are: web, api, packages/*, ' +
        '<package-name>',
      type: 'string',
      array: true,
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
    .option('ud', {
      type: 'boolean',
      default: false,
      description:
        'Build the Universal Deploy server entry (api/dist/ud/index.js).',
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
    .check((argv: BuildArgv) => {
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
          c.error(`Unknown workspace(s) ${workspacesArg.join(' ')}`) +
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

export const handler = async (options: Record<string, unknown>) => {
  const { handler } = await import('./build/buildHandler.js')
  return handler(options)
}
