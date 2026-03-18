// Run `npx browserslist "defaults"` to see a list of target browsers.
const TARGETS_BROWSERS = ['defaults']

// We use the recommended babel configuration for monorepos, which is a base directory
// `babel.config.js` file, but then use a per-project `.babelrc.js` file.
// Learn more: https://babeljs.io/docs/en/config-files#monorepos

/** @type {import('@babel/core').TransformOptions} */
module.exports = {
  presets: [
    ['@babel/preset-react', { runtime: 'automatic' }],
    /**
     *  TODO(pc): w/ '@babel/plugin-transform-typescript' in plugins now, is '@babel/typescript' preset still needed?
     *
     * - Plugins run before Presets.
     * - Plugin ordering is first to last.
     * - Preset ordering is reversed (last to first).
     *
     * https://babeljs.io/docs/en/plugins/#plugin-ordering
     */
    '@babel/typescript',
  ],
  plugins: [
    /**
     * NOTE
     * Needed for react@18
     *
     * ```
     * ✖  @cedarjs/router:build
     *  SyntaxError: /code/redwood/packages/router/src/location.tsx: TypeScript 'declare' fields must first be transformed by @babel/plugin-transform-typescript.
     *  If you have already enabled that plugin (or '@babel/preset-typescript'), make sure that it runs before any plugin related to additional class features:
     *   - @babel/plugin-proposal-class-properties
     *   - @babel/plugin-proposal-private-methods
     *   - @babel/plugin-proposal-decorators
     *    25 |   // When prerendering, there might be more than one level of location
     *    26 |   // providers. Use the values from the one above.
     *  > 27 |   declare context: React.ContextType<typeof LocationContext>
     *       |   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
     *    28 |   HISTORY_LISTENER_ID: string | undefined = undefined
     *    29 |
     *    30 |   state = {
     * ```
     */
    [
      '@babel/plugin-transform-typescript',
      {
        allowDeclareFields: true,
        /** needed in order build `packages/web/dist/entry/index.js` */
        isTSX: true,
        allExtensions: true,
      },
    ],
    /**
     * NOTE
     * Experimental decorators are used in `@cedarjs/structure`.
     * https://github.com/tc39/proposal-decorators
     **/
    ['@babel/plugin-proposal-decorators', { legacy: true }],
    ['@babel/plugin-transform-runtime'],
    '@babel/plugin-syntax-import-attributes',
  ],
  overrides: [
    // ** WEB PACKAGES **
    {
      test: [
        './packages/auth/',
        './packages/router',
        './packages/forms/',
        './packages/web/',
      ],
      presets: [
        [
          '@babel/preset-env',
          {
            targets: {
              browsers: TARGETS_BROWSERS,
            },
          },
        ],
      ],
      plugins: [
        [
          'babel-plugin-auto-import',
          {
            declarations: [
              {
                // import { React } from 'react'
                default: 'React',
                path: 'react',
              },
            ],
          },
        ],
      ],
    },
  ],
  // Ignore test directories when we're not testing
  // Note: No matter what you try to do here, babel will still include
  // snapshot files in the dist output.
  // See https://github.com/babel/babel/issues/11394
  ignore:
    process.env.NODE_ENV === 'test'
      ? []
      : [/\.test\.(js|ts)/, '**/__tests__', '**/__mocks__', '**/__snapshots__'],
}
