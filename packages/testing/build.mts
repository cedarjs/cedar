import fs from 'node:fs'

import { buildCjs, buildEsm } from '@cedarjs/framework-tools'
import {
  generateTypesCjs,
  generateTypesEsm,
  insertCommonJsPackageJson,
} from '@cedarjs/framework-tools/generateTypes'

await buildEsm()
await generateTypesEsm()

// // Build Jest config files with glob pattern for CommonJS
// await build({
//   buildOptions: {
//     outdir: 'dist/cjs/config/jest',
//     outbase: 'config/jest',
//     platform: 'node',
//     target: ['node20'],
//     format: 'cjs',
//     logLevel: 'info',
//     metafile: true,
//   },
//   entryPointOptions: {
//     patterns: ['./config/jest/**/*.ts'],
//     ignore: ['**/__tests__/**'],
//   },
//   metafileName: 'meta.jest-config.json',
// })

await buildCjs()
await generateTypesCjs()
await insertCommonJsPackageJson({
  buildFileUrl: import.meta.url,
})

fs.rmSync('./config', { recursive: true, force: true })
fs.mkdirSync('./config')
fs.cpSync('./dist/cjs/config', './config', { recursive: true })
fs.cpSync('./dist/cjs/package.json', './config/package.json')

// Replace relative imports with absolute @cedarjs/testing/dist/cjs imports in built CJS files
function replaceImportsInFile(filePath: string) {
  if (!fs.existsSync(filePath)) {
    return
  }

  const content = fs.readFileSync(filePath, 'utf-8')
  const updatedContent = content
    .replaceAll('"../../../api', '"@cedarjs/testing/dist/cjs/api')
    .replaceAll('"../../../web', '"@cedarjs/testing/dist/cjs/web')

  if (content !== updatedContent) {
    fs.writeFileSync(filePath, updatedContent)
    console.log(`Updated imports in ${filePath}`)
  }
}

// Apply import replacements to the relevant files
replaceImportsInFile('./config/jest/api/globalSetup.js')
replaceImportsInFile('./config/jest/api/jest.setup.js')
replaceImportsInFile('./config/jest/web/jest.setup.js')

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

// Similar to above, here are more files with `await import` that I need to
// update to use `require` instead
const configJestApiJestSetupPath = './config/jest/api/jest.setup.js'
const apiJestSetupFile = fs.readFileSync(configJestApiJestSetupPath, 'utf-8')
fs.writeFileSync(
  configJestApiJestSetupPath,
  apiJestSetupFile.replaceAll('await import', 'require'),
)
const configJestWebJestSetupPath = './config/jest/web/jest.setup.js'
const webJestSetupFile = fs.readFileSync(configJestWebJestSetupPath, 'utf-8')
fs.writeFileSync(
  configJestWebJestSetupPath,
  webJestSetupFile.replaceAll('await import', 'require'),
)
