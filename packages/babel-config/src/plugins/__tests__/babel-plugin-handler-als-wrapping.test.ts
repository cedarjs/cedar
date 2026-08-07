import path from 'path'

import pluginTester from 'babel-plugin-tester'

import handlerAlsWrappingPlugin from '../babel-plugin-handler-als-wrapping.js'

pluginTester({
  plugin: handlerAlsWrappingPlugin,
  pluginName: 'babel-plugin-handler-als-wrapping',
  fixtures: path.join(__dirname, '__fixtures__/handler-als-wrapping'),
})
