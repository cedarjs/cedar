const { getWebSideDefaultBabelConfig } = require('@cedarjs/babel-config')

const redwoodCellsPlugin = require('../babelPlugins/babel-plugin-redwood-cell')

const defaultWebSideBabelConfig = getWebSideDefaultBabelConfig({
  forJest: true,
})

module.exports = {
  ...defaultWebSideBabelConfig,
  overrides: [
    ...defaultWebSideBabelConfig.overrides,
    {
      test: /.+Cell.(js|tsx|jsx)$/,
      plugins: [redwoodCellsPlugin],
    },
  ],
}
