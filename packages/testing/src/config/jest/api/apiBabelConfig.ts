import {
  getApiSideDefaultBabelConfig,
  getApiSideBabelPresets,
  getApiSideBabelPlugins,
} from '@cedarjs/babel-config'

// Since configFile and babelrc is already passed a level up, cleaning up these keys here.
// babelrc can not reside inside "extend"ed
// Ref: packages/testing/config/jest/api/index.js
const { babelrc: _b, ...defaultBabelConfig } = getApiSideDefaultBabelConfig()

type ConfigType = Omit<
  ReturnType<typeof getApiSideDefaultBabelConfig>,
  'babelrc'
>

const config: ConfigType = {
  ...defaultBabelConfig,
  plugins: getApiSideBabelPlugins(),
  presets: getApiSideBabelPresets({
    presetEnv: true, // jest needs code transpiled
  }),
}

export default config
