import type { Argv } from 'yargs'

export const command = 'jobs'
export const description =
  'Starts the RedwoodJob runner to process background jobs'

export const builder = (yargs: Argv) => {
  // Disable yargs parsing of commands and options because it's forwarded
  // to rw-jobs
  yargs
    .strictOptions(false)
    .strictCommands(false)
    .strict(false)
    .parserConfiguration({
      'camel-case-expansion': false,
    })
    .help(false)
    .version(false)
}

export const handler = async (options: Record<string, unknown>) => {
  // @ts-expect-error - Types not available for JS files
  const { handler } = await import('./jobsHandler.js')
  return handler(options)
}
