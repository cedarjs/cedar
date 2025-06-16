export const command = 'record <command>'
export const description =
  'Setup RedwoodRecord for your project. Caches a JSON version of your data model and adds api/src/models/index.js with some config.'
import { terminalLink } from 'termi-link'

export const builder = (yargs) =>
  yargs
    .command({ command, description, handler })
    .demandCommand()
    .epilogue(
      `Also see the ${terminalLink(
        'RedwoodRecord Docs',
        'https://redwoodjs.com/docs/redwoodrecord',
      )}\n`,
    )

async function handler(argv) {
  const recordInit = await import('./record/init.js')

  recordInit(argv)
}
