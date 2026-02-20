import { terminalLink } from 'termi-link'
import type { Argv } from 'yargs'

// @ts-expect-error - Types not available for JS files
import { workspaces } from '../lib/project.js'

export const command = 'type-check [sides..]'
export const aliases = ['tsc', 'tc']
export const description = 'Run a TypeScript compiler check on your project'
export const builder = (yargs: Argv) => {
  yargs
    .strict(false) // so that we can forward arguments to tsc
    .positional('sides', {
      default: workspaces(),
      description: 'Which side(s) to run a typecheck on',
      type: 'string',
      array: true,
    })
    .option('prisma', {
      type: 'boolean',
      default: true,
      description: 'Generate the Prisma client',
    })
    .option('generate', {
      type: 'boolean',
      default: true,
      description: 'Regenerate types within the project',
    })
    .option('verbose', {
      alias: 'v',
      default: false,
      description: 'Print more',
      type: 'boolean',
    })
    .epilogue(
      `Also see the ${terminalLink(
        'CedarJS CLI Reference',
        'https://cedarjs.com/docs/cli-commands#type-check',
      )}`,
    )
}

export const handler = async (options: Record<string, unknown>) => {
  // @ts-expect-error - Types not available for JS files
  const { handler } = await import('./type-checkHandler.js')
  return handler(options)
}
