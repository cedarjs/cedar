import { terminalLink } from 'termi-link'
import type { Argv } from 'yargs'

import * as fragmentsCommand from './features/fragments/fragments.js'
import * as trustedDocumentsCommand from './features/trustedDocuments/trustedDocuments.js'

export const command = 'graphql <feature>'
export const description = 'Set up GraphQL feature support'
export function builder(yargs: Argv) {
  return yargs
    .command(fragmentsCommand)
    .command(trustedDocumentsCommand)
    .epilogue(
      `Also see the ${terminalLink(
        'CedarJS CLI Reference',
        'https://cedarjs.com/docs/cli-commands#setup-graphql',
      )}`,
    )
}
