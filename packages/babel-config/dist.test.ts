import path from 'node:path'

const distPath = path.join(__dirname, 'dist')

describe('dist', () => {
  it('exports', async () => {
    const { default: mod } = await import(path.join(distPath, 'index.js'))

    // We use this to calculate the diff in minor versions
    const runtimeMinorVersion = mod.RUNTIME_CORE_JS_VERSION.split('.')[1]
    // We use this to allow all patch versions
    const runtimePatchVersion = mod.RUNTIME_CORE_JS_VERSION.split('.')[2]

    const expectedRuntimeMinorVersion = 28

    // Allow a minor version difference of 1
    expect(
      Math.abs(expectedRuntimeMinorVersion - runtimeMinorVersion),
    ).toBeLessThanOrEqual(1)

    expect(mod).toMatchInlineSnapshot(`
      {
        "BABEL_PLUGIN_TRANSFORM_RUNTIME_OPTIONS": {
          "corejs": {
            "proposals": true,
            "version": 3,
          },
          "version": "7.${runtimeMinorVersion}.${runtimePatchVersion}",
        },
        "CORE_JS_VERSION": "3.47",
        "RUNTIME_CORE_JS_VERSION": "7.${runtimeMinorVersion}.${runtimePatchVersion}",
        "TARGETS_NODE": "20.10",
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
