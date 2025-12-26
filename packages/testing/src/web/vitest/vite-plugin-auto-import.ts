import autoImport from 'unplugin-auto-import/vite'

export function autoImportsPlugin() {
  return autoImport({
    // targets to transform
    include: [
      /\.[tj]sx?$/, // .ts, .tsx, .js, .jsx
    ],

    // global imports to register
    imports: [
      {
        '@cedarjs/testing/web': [
          'mockGraphQLQuery',
          'mockGraphQLMutation',
          'mockCurrentUser',
        ],
      },
    ],

    // We provide our mocking types elsewhere and so don't need this plugin to
    // generate them.
    dts: false,
  })
}
