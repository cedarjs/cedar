import { getWebSideDefaultBabelConfig } from '@cedarjs/babel-config'

import redwoodCellsPlugin from '../babelPlugins/babel-plugin-redwood-cell.js'

const defaultWebSideBabelConfig = getWebSideDefaultBabelConfig({
  forJest: true,
})

export default {
  ...defaultWebSideBabelConfig,
  overrides: [
    ...defaultWebSideBabelConfig.overrides,
    {
      test: /.+Cell.(js|tsx|jsx)$/,
      plugins: [redwoodCellsPlugin],
    },
  ],
}
