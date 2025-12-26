import { terminalLink } from 'termi-link'

export const command = 'exec [name]'
export const description = 'Run scripts generated with yarn generate script'
export const builder = (yargs) => {
  yargs
    .positional('name', {
      description: 'The file name (extension is optional) of the script to run',
      type: 'string',
    })
    .option('prisma', {
      type: 'boolean',
      default: true,
      description: 'Generate the Prisma client',
    })
    .option('list', {
      alias: 'l',
      type: 'boolean',
      default: false,
      description: 'List available scripts',
    })
    .option('silent', {
      alias: 's',
      type: 'boolean',
      default: false,
      description: "Silence CedarJS's output, leaving only the script output",
    })
    .strict(false)
    .epilogue(
      `Also see the ${terminalLink(
        'CedarJS CLI Reference',
        'https://cedarjs.com/docs/cli-commands#exec',
      )}`,
    )
}

export const handler = async (options) => {
  const { handler } = await import('./execHandler.js')
  return handler(options)
}
