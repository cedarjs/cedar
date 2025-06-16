import { terminalLink } from 'termi-link'

export const deployBuilder = (yargs) => {
  yargs
    .option('build', {
      description: 'Build for production',
      type: 'boolean',
      default: 'true',
    })
    .option('prisma', {
      description: 'Apply database migrations',
      type: 'boolean',
      default: 'true',
    })
    .option('data-migrate', {
      description: 'Migrate the data in your database',
      type: 'boolean',
      default: 'true',
      alias: 'dm',
    })
    .epilogue(
      `For more commands, options, and examples, see ${terminalLink(
        'Redwood CLI Reference',
        'https://redwoodjs.com/docs/cli-commands#deploy',
      )}`,
    )
}
