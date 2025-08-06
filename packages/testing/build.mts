import fs from 'node:fs'

import { build, buildCjs, buildEsm } from '@cedarjs/framework-tools'
import {
  generateTypesCjs,
  generateTypesEsm,
  insertCommonJsPackageJson,
} from '@cedarjs/framework-tools/generateTypes'

await buildEsm()
await generateTypesEsm()

// Build Jest config files with glob pattern for CommonJS
await build({
  buildOptions: {
    outdir: 'dist/cjs/config/jest',
    outbase: 'config/jest',
    platform: 'node',
    target: ['node20'],
    format: 'cjs',
    logLevel: 'info',
    metafile: true,
  },
  entryPointOptions: {
    patterns: ['./config/jest/**/*.ts'],
    ignore: ['**/__tests__/**'],
  },
  metafileName: 'meta.jest-config.json',
})

await buildCjs()
await generateTypesCjs()
await insertCommonJsPackageJson({
  buildFileUrl: import.meta.url,
})

// ./src/web/mockRequests.js contains `... = await import('msw/node'`. When
// building for CJS esbuild correctly preserves the `await import` statement
// because it's valid in both CJS and ESM (whereas regular imports are only
// valid in ESM).
// The problem is that this file will be consumed by Jest, and jest doesn't
// support that syntax. They only support `require()`.
// That's why we have to do manual editing of built files here
const mockRequestsBuildPath = './dist/cjs/web/mockRequests.js'
const mockRequestsFile = fs.readFileSync(mockRequestsBuildPath, 'utf-8')
fs.writeFileSync(
  mockRequestsBuildPath,
  mockRequestsFile.replaceAll('await import', 'require'),
)
