import path from 'path'

import pluginTester from 'babel-plugin-tester'
import { vi } from 'vitest'

import cedarGraphqlOptionsExtract from '../babel-plugin-cedar-graphql-options-extract.js'

vi.mock('@cedarjs/project-config', () => {
  return {
    getBaseDirFromFile: () => {
      return ''
    },
  }
})

pluginTester({
  plugin: cedarGraphqlOptionsExtract,
  pluginName: 'babel-plugin-cedar-graphql-options-extract',
  fixtures: path.join(__dirname, '__fixtures__/graphql-options-extract'),
})
