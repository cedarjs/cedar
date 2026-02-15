import { terminalLink } from 'termi-link'
import type { Argv } from 'yargs'

export const command = 'record <command>'
export const description =
  'Setup RedwoodRecord for your project. Caches a JSON version of your data model and adds api/src/models/index.js with some config.'

export const builder = (yargs: Argv) =>
  yargs
    .command(command, description, () => {}, handler)
    .demandCommand()
    .epilogue(
      `Also see the ${terminalLink(
        'RedwoodRecord Docs',
        'https://cedarjs.com/docs/redwoodrecord',
      )}\n`,
    )

async function handler(argv: Record<string, unknown>) {
  // @ts-expect-error - Types not available for JS files
  const recordInit = await import('./record/init.js')

  recordInit(argv)
}
