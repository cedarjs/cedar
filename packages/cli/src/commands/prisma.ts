import type { Argv } from 'yargs'

export const command = 'prisma [commands..]'
export const description = 'Run Prisma CLI with experimental features'

/**
 * This is a lightweight wrapper around Prisma's CLI with some Cedar CLI modifications.
 */
export const builder = (yargs: Argv) => {
  // Disable yargs parsing of commands and options because it's forwarded
  // to Prisma CLI.
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
  const { handler } = await import('./prismaHandler.js')
  return handler(options)
}
