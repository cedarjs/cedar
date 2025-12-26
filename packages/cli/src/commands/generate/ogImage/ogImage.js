import { terminalLink } from 'termi-link'

import { isTypeScriptProject } from '../../../lib/project.js'
import { createHandler } from '../yargsCommandHelpers.js'

export const description = 'Generate an og:image component'
export const command = 'og-image <path>'
export const aliases = ['ogImage', 'ogimage']
export const builder = (yargs) => {
  yargs
    .positional('path', {
      description: `Path to the page to create the og:image component for (ex: \`Products/ProductPage\`)`,
      type: 'string',
    })
    .epilogue(
      `Also see the ${terminalLink(
        'CedarJS CLI Reference',
        `https://cedarjs.com/docs/cli-commands#generate-og-image`,
      )}`,
    )
    .option('typescript', {
      alias: 'ts',
      description: 'Generate TypeScript files',
      type: 'boolean',
      default: isTypeScriptProject(),
    })
    .option('force', {
      alias: 'f',
      description: 'Overwrite existing files',
      type: 'boolean',
      default: false,
    })
    .option('verbose', {
      description: 'Print all logs',
      type: 'boolean',
      default: false,
    })
    .option('rollback', {
      description: 'Revert all generator actions if an error occurs',
      type: 'boolean',
      default: true,
    })
}
export const handler = createHandler('ogImage')
