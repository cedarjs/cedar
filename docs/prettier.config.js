/* eslint-env node */
// @ts-check

const rootConfig = require('../prettier.config')

/**
 * @see https://prettier.io/docs/en/configuration.html
 * @type {import("prettier").Config}
 */
const config = {
  ...rootConfig,
  trailingComma: 'es5',
  overrides: [
    ...(rootConfig.overrides ?? []),
    {
      // Use the MDX parser for .md files so that {/* */} comments are
      // recognised as JSX expressions and left untouched, rather than having
      // their * characters normalised to _ by the standard Markdown parser.
      files: ['**/*.md'],
      options: {
        parser: 'mdx',
      },
    },
  ],
}

module.exports = config
