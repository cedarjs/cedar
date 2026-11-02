import { terminalLink } from 'termi-link'
import type { Argv } from 'yargs'

/**
 * Returns true when the CLI arguments are for `cedar deploy render api`.
 *
 * `deploy`, `render` and `api` must appear in that order. Other tokens, like
 * global options (`--cwd ../app`) or render options (`--no-prisma`), may
 * appear anywhere around them.
 */
export function isRenderApiDeploy(args: string[]) {
  const deployIndex = args.indexOf('deploy')

  if (deployIndex === -1) {
    return false
  }

  const renderIndex = args.indexOf('render', deployIndex + 1)

  if (renderIndex === -1) {
    return false
  }

  return args.includes('api', renderIndex + 1)
}

// It's easy for the api side to exceed Render's free-plan memory limit, so
// telemetry is disabled for `cedar deploy render api`.
// The CLI imports every command module at startup and decides whether to
// start telemetry and add telemetryMiddleware before any handler runs, so the
// env var has to be set here, at module level, rather than in the handler.
if (isRenderApiDeploy(process.argv.slice(2))) {
  process.env.CEDAR_DISABLE_TELEMETRY = '1'
}

export const command = 'render <side>'
export const description = 'Build, migrate, and serve command for Render deploy'

export const builder = (yargs: Argv) => {
  yargs
    .positional('side', {
      choices: ['api', 'web'],
      description: 'Side to deploy',
      type: 'string',
    })
    .option('prisma', {
      description: 'Apply database migrations',
      type: 'boolean',
      default: true,
    })
    .option('data-migrate', {
      description: 'Apply data migrations',
      type: 'boolean',
      default: true,
      alias: 'dm',
    })
    .epilogue(
      `For more commands, options, and examples, see ${terminalLink(
        'CedarJS CLI Reference',
        'https://cedarjs.com/docs/cli-commands#deploy',
      )}`,
    )
}

export async function handler(yargs: Record<string, unknown>) {
  const { handler: importedHandler } = await import('./renderHandler.js')

  return importedHandler(yargs)
}
