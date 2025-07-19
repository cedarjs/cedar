import fs from 'node:fs'

import {
  build,
  defaultBuildOptions,
  defaultIgnorePatterns,
  buildEsm,
} from '@cedarjs/framework-tools'
import {
  generateTypesEsm,
  insertCommonJsPackageJson,
} from '@cedarjs/framework-tools/generateTypes'

await buildEsm()
await generateTypesEsm()

// CJS Build
await build({
  entryPointOptions: {
    ignore: [...defaultIgnorePatterns, '**/globRoutesImporter.ts'],
  },
  buildOptions: {
    ...defaultBuildOptions,
    tsconfig: 'tsconfig.cjs.json',
    outdir: 'dist/cjs',
  },
})
// Skipping this for now. Need to decide if I should support both ESM and CJS
// projects once ESM support is done or not
// await generateTypesCjs()
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
