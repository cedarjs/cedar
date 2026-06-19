import { terminalLink } from 'termi-link'
import type { Argv } from 'yargs'

export const deployBuilder = (yargs: Argv) => {
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
        'CedarJS CLI Reference',
        'https://cedarjs.com/docs/cli-commands#deploy',
      )}`,
    )
}
