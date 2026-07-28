import { defineConfig } from 'vite'

import { cedarApiImportGuardPlugin } from '../../../../vite-plugin-cedar-api-import-guard.js'

// Stands in for a Cedar project's web/vite.config.ts, which gets its plugins
// from cedar()
export default defineConfig({
  plugins: [cedarApiImportGuardPlugin()],
})
