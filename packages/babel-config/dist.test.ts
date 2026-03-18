import path from 'node:path'

const distPath = path.join(__dirname, 'dist')

describe('dist', () => {
  it('exports', async () => {
    const { default: mod } = await import(path.join(distPath, 'index.js'))

    expect(mod).toMatchInlineSnapshot(`
      {
        "TARGETS_NODE": "24",
        "getApiSideBabelConfigPath": [Function],
        "getApiSideBabelPlugins": [Function],
        "getApiSideBabelPresets": [Function],
        "getApiSideDefaultBabelConfig": [Function],
        "getCommonPlugins": [Function],
        "getPathsFromConfig": [Function],
        "getRouteHookBabelPlugins": [Function],
        "getWebSideBabelConfigPath": [Function],
        "getWebSideBabelPlugins": [Function],
        "getWebSideBabelPresets": [Function],
        "getWebSideDefaultBabelConfig": [Function],
        "getWebSideOverrides": [Function],
        "parseTypeScriptConfigFiles": [Function],
        "registerApiSideBabelHook": [Function],
        "registerBabel": [Function],
        "registerWebSideBabelHook": [Function],
        "transformWithBabel": [Function],
      }
    `)
  })
})
