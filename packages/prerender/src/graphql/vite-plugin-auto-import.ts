import autoImport from 'unplugin-auto-import/vite'

export function autoImportsPlugin() {
  return autoImport({
    // targets to transform
    include: [
      /\.[tj]sx?$/, // .ts, .tsx, .js, .jsx
    ],

    // global imports to register
    imports: [
      // import { gql } from 'graphql-tag'
      {
        'graphql-tag': ['gql'],
      },
      // import { context } from '@cedarjs/context'
      {
        '@cedarjs/context': ['context'],
      },
    ],

    // Types aren't important since the output is ephemeral
    dts: false,
  })
}
