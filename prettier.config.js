/* eslint-env node */
// @ts-check

/**
 * @see https://prettier.io/docs/en/configuration.html
 * @type {import("prettier").Config}
 */
const config = {
  // The default changed from 'es5' to 'all' in Prettier v3. It'd be better
  // if this framework config matched the config we use for projects. And
  // ideally they'd both stay as close as possible to the defaults. But for
  // now it's too disruptive to change the config for projects, and I don't
  // want to change *away* from defaults here. So I'm leaving it as 'all'.
  trailingComma: 'all',
  bracketSpacing: true,
  tabWidth: 2,
  semi: false,
  singleQuote: true,
  plugins: [
    'prettier-plugin-curly',
    // See here for why this is commented out
    // https://github.com/cedarjs/cedar/issues/964
    // 'prettier-plugin-sh',
    'prettier-plugin-packagejson',
  ],
  overrides: [
    {
      files: ['tsconfig.cjs.json'],
      options: {
        parser: 'jsonc',
        trailingComma: 'none',
      },
    },
  ],
}

module.exports = config
