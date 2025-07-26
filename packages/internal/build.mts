import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

import {
  buildExternalEsm,
  buildExternalCjs,
  copyAssets,
} from '@cedarjs/framework-tools'

await buildExternalEsm()
await buildExternalCjs()

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))

// Add package.json to CJS directory to mark it as CommonJS
const cjsPackageJsonPath = path.join(__dirname, 'dist', 'cjs', 'package.json')
fs.writeFileSync(
  cjsPackageJsonPath,
  JSON.stringify({ type: 'commonjs' }, null, 2),
)

// Copy ESM type files to CJS directory
const esmDistPath = path.join(__dirname, 'dist')
const cjsDistPath = path.join(__dirname, 'dist', 'cjs')

fs.cpSync(esmDistPath, cjsDistPath, {
  recursive: true,
  filter: (src) => {
    // Only copy .d.ts files and skip the cjs directory itself
    return src.endsWith('.d.ts') && !src.includes('/cjs/')
  },
})

await copyAssets({
  buildFileUrl: import.meta.url,
  patterns: ['generate/templates/**/*.template'],
})
