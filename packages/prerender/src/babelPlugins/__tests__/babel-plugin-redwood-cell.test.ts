import path from 'path'

import pluginTester from 'babel-plugin-tester'

import { babelPluginRedwoodCell } from '../babel-plugin-redwood-cell'

pluginTester({
  plugin: babelPluginRedwoodCell,
  pluginName: 'babel-plugin-redwood-cell',
  fixtures: path.join(__dirname, '__fixtures__/cell'),
})
