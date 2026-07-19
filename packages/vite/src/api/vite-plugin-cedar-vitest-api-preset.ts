import {
  autoImportsPlugin,
  cedarVitestApiConfigPlugin,
  trackDbImportsPlugin,
} from '@cedarjs/testing/api/vitest'

import { cedarImportDirPlugin } from '../plugins/vite-plugin-cedar-import-dir.js'
import { cedarjsJobPathInjectorPlugin } from '../plugins/vite-plugin-cedarjs-job-path-injector.js'
import { cedarjsResolveCedarStyleImportsPlugin } from '../plugins/vite-plugin-cedarjs-resolve-cedar-style-imports.js'

export function cedarVitestPreset() {
  return [
    cedarImportDirPlugin(),
    cedarjsJobPathInjectorPlugin(),
    cedarVitestApiConfigPlugin(),
    autoImportsPlugin(),
    cedarjsResolveCedarStyleImportsPlugin(),
    trackDbImportsPlugin(),
  ]
}
