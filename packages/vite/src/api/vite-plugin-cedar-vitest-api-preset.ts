import {
  autoImportsPlugin,
  cedarVitestApiConfigPlugin,
  trackDbImportsPlugin,
} from '@cedarjs/testing/api/vitest'

import { cedarjsDirectoryNamedImportPlugin } from '../plugins/vite-plugin-cedarjs-directory-named-import.js'

export function cedarVitestPreset() {
  return [
    cedarVitestApiConfigPlugin(),
    autoImportsPlugin(),
    cedarjsDirectoryNamedImportPlugin(),
    trackDbImportsPlugin(),
  ]
}
