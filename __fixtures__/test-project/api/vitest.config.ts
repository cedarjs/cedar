import path from 'node:path'

import { defineConfig } from 'vitest/config'

import { cedarjsDirectoryNamedImportPlugin } from '@cedarjs/vite'

export default defineConfig({
  plugins: [cedarjsDirectoryNamedImportPlugin()],
  resolve: {
    alias: {
      src: path.resolve(__dirname, './src'),
    },
  },
  test: {
    fileParallelism: false,
    globals: true,
  },
})
