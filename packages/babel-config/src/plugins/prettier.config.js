/* eslint-env node */
// @ts-check

/**
 * @see https://prettier.io/docs/en/configuration.html
 * @type {import("prettier").Config}
 */
const config = {
  bracketSpacing: true,
  tabWidth: 2,
  semi: false,
  singleQuote: true,
  plugins: [
    'prettier-plugin-curly',
    // I have this prettier config here because babel-plugin-tester v11 that
    // we're currently using uses prettier v2, and prettier-plugin-sh requires
    // prettier v3. By putting this prettier config here, babel-plugin-tester
    // will use this, and run its output through prettier without loading the
    // prettier-plugin-sh plugin, which it really doesn't need anyway since
    // we're not asking it to format shell scripts or other shell files.
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
