import { terminalLink } from 'termi-link'

import * as libraryChakraUi from './libraries/chakra-ui.js'
import * as libraryMantine from './libraries/mantine.js'
import * as libraryTailwindCss from './libraries/tailwindcss.js'

export const command = 'ui <library>'
export const description = 'Set up a UI design or style library'
export const builder = (yargs) =>
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
