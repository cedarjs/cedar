import { terminalLink } from 'termi-link'

export const command = 'serverless'
export const aliases = ['aws serverless', 'sls']
export const description = 'Deploy to AWS via the serverless framework'

export const builder = (yargs) => {
  yargs.option('stage', {
    describe:
      'serverless stage pass through param: https://www.serverless.com/blog/stages-and-environments',
    default: 'production',
    type: 'string',
  })

  yargs.option('sides', {
    describe: 'which Side(s) to deploy',
    choices: ['api', 'web'],
    default: ['api', 'web'],
    alias: 'side',
    type: 'array',
  })

  yargs.option('verbose', {
    describe: 'verbosity of logs',
    default: true,
    type: 'boolean',
  })

  yargs.option('pack-only', {
    describe: 'Only build and pack, and dont push code up using serverless',
    default: false,
    type: 'boolean',
  })

  yargs.option('first-run', {
    describe:
      'Set this flag the first time you deploy, to configure your API URL on the webside',
    default: false,
    type: 'boolean',
  })

  yargs.epilogue(
    `Also see the ${terminalLink(
      'Redwood CLI Reference',
      'https://redwoodjs.com/docs/cli-commands#deploy',
    )}\n`,
  )
}

export async function handler(yargs) {
  const { handler: importedHandler } = await import('./serverlessHandler.js')

  return importedHandler(yargs)
}
