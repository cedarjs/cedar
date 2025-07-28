import { terminalLink } from 'termi-link'

import { createHandler, getYargsDefaults } from '../yargsCommandHelpers.js'

export const command = 'scaffold <model>'
export const description =
  'Generate Pages, SDL, and Services files based on a given DB schema Model. Also accepts <path/model>'
export const builder = (yargs) => {
  yargs
    .positional('model', {
      description:
        "Model to scaffold. You can also use <path/model> to nest files by type at the given path directory (or directories). For example, 'rw g scaffold admin/post'",
    })
    .option('docs', {
      description: 'Generate SDL and GraphQL comments to use in documentation',
      type: 'boolean',
      default: false,
    })
    .option('tests', {
      description: 'Generate test files',
      type: 'boolean',
    })
    .option('tailwind', {
      description:
        'Generate TailwindCSS version of scaffold.css (automatically set to `true` if TailwindCSS config exists)',
      type: 'boolean',
    })
    .option('rollback', {
      description: 'Revert all generator actions if an error occurs',
      type: 'boolean',
      default: true,
    })
    .epilogue(
      `Also see the ${terminalLink(
        'CedarJS CLI Reference',
        'https://cedarjs.com/docs/cli-commands#generate-scaffold',
      )}`,
    )

  // Merge generator defaults in
  Object.entries(getYargsDefaults()).forEach(([option, config]) => {
    yargs.option(option, config)
  })
}

export const handler = createHandler('scaffold')
