import { autoImportsPlugin } from '@cedarjs/testing/api/vitest'
import { cedarVitestApiConfigPlugin } from '@cedarjs/testing/api/vitest'
import { trackDbImportsPlugin } from '@cedarjs/testing/api/vitest'

import { cedarjsDirectoryNamedImportPlugin } from '../plugins/vite-plugin-cedarjs-directory-named-import.js'

export function cedarVitestPreset() {
  return [
    cedarVitestApiConfigPlugin(),
    autoImportsPlugin(),
    cedarjsDirectoryNamedImportPlugin(),
    trackDbImportsPlugin(),
  ]
}
