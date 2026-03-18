import { terminalLink } from 'termi-link'
import type { Argv } from 'yargs'

// @ts-expect-error - Types not available for JS files
import * as libraryChakraUi from './libraries/chakra-ui.js'
// @ts-expect-error - Types not available for JS files
import * as libraryMantine from './libraries/mantine.js'
// @ts-expect-error - Types not available for JS files
import * as libraryTailwindCss from './libraries/tailwindcss.js'

export const command = 'ui <library>'
export const description = 'Set up a UI design or style library'
export const builder = (yargs: Argv) =>
  yargs
    .command(libraryChakraUi)
    .command(libraryMantine)
    .command(libraryTailwindCss)
    .demandCommand()
    .epilogue(
      `Also see the ${terminalLink(
        'CedarJS CLI Reference',
        'https://cedarjs.com/docs/cli-commands#setup-ui',
      )}`,
    )
