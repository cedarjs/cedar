import {
  autoImportsPlugin,
  cedarVitestApiConfigPlugin,
  trackDbImportsPlugin,
} from '@cedarjs/testing/api/vitest'

import { cedarImportDirPlugin } from '../plugins/vite-plugin-cedar-import-dir.js'
import { cedarjsResolveCedarStyleImportsPlugin } from '../plugins/vite-plugin-cedarjs-resolve-cedar-style-imports.js'

export function cedarVitestPreset() {
  return [
    cedarImportDirPlugin(),
    cedarVitestApiConfigPlugin(),
    autoImportsPlugin(),
    cedarjsResolveCedarStyleImportsPlugin(),
    trackDbImportsPlugin(),
  ]
}
