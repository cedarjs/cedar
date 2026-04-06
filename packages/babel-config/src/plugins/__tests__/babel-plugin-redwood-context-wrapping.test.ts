import path from 'path'

import pluginTester from 'babel-plugin-tester'

import redwoodOtelWrappingPlugin from '../babel-plugin-redwood-context-wrapping.js'

pluginTester({
  plugin: redwoodOtelWrappingPlugin,
  pluginName: 'babel-plugin-redwood-context-wrapping',
  fixtures: path.join(__dirname, '__fixtures__/context-wrapping'),
})
