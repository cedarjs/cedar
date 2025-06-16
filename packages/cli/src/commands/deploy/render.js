import { terminalLink } from 'termi-link'

// It's easy for the api side to exceed Render's free-plan limit.
// Because telemetryMiddleware is added to Yargs as middleware,
// we need to set the env var here outside the handler to correctly disable it.
if (process.argv.slice(2).includes('api')) {
  process.env.REDWOOD_DISABLE_TELEMETRY = 1
}

export const command = 'render <side>'
export const description = 'Build, migrate, and serve command for Render deploy'

export const builder = (yargs) => {
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
        'Redwood CLI Reference',
        'https://redwoodjs.com/docs/cli-commands#deploy',
      )}`,
    )
}

export async function handler(yargs) {
  const { handler: importedHandler } = await import('./renderHandler.js')

  return importedHandler(yargs)
}
