import { terminalLink } from 'termi-link'
import type { Argv } from 'yargs'

// @ts-expect-error - Types not available for JS files
import c from '../lib/colors.js'
// @ts-expect-error - Types not available for JS files
import { exitWithError } from '../lib/exit.js'
// @ts-expect-error - Types not available for JS files
import { sides } from '../lib/project.js'
// @ts-expect-error - Types not available for JS files
import { checkNodeVersion } from '../middleware/checkNodeVersion.js'

export const command = 'build [side..]'
export const description = 'Build for production'

export const builder = (yargs: Argv) => {
  const choices = sides()

  yargs
    .positional('side', {
      choices,
      default: choices,
      description: 'Which side(s) to build',
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
    .epilogue(
      `Also see the ${terminalLink(
        'CedarJS CLI Reference',
        'https://cedarjs.com/docs/cli-commands#build',
      )}`,
    )
}

export const handler = async (options: Record<string, unknown>) => {
  const { handler } = await import('./buildHandler.js')
  return handler(options)
}
