import fs from 'node:fs'

import { build, buildEsm, defaultBuildOptions } from '@cedarjs/framework-tools'
import {
  generateTypesCjs,
  generateTypesEsm,
  insertCommonJsPackageJson,
} from '@cedarjs/framework-tools/generateTypes'

await buildEsm()
await generateTypesEsm()

await build({
  buildOptions: {
    ...defaultBuildOptions,
    tsconfig: 'tsconfig.cjs.json',
    outdir: 'dist/cjs',
    logOverride: {
      // This feels a bit dangerous, I wish I could do this with a comment
      // inside the file where I need this for greater control, but I haven't
      // found a way to do that yet.
      // This is to silence the CJS warning for `import.meta.glob` and
      // `import.meta.dirname`
      'empty-import-meta': 'silent',
    },
  },
})
await generateTypesCjs()
await insertCommonJsPackageJson({
  buildFileUrl: import.meta.url,
})

fs.rmSync('./config', { recursive: true, force: true })
fs.mkdirSync('./config')
fs.cpSync('./dist/cjs/config', './config', { recursive: true })
fs.cpSync('./dist/cjs/package.json', './config/package.json')

// Some background on the package.json related commands below: I've been having
// problems with jest testing in CI sometimes failing to find the jest preset
// file. I don't know why. But after deep-diving into the jest source code I
// realized it was looking for a package.json in the same directory as it first
// tries to find the preset. It's supposed to traverse up the folder tree if it
// can't find one, until it does. I'm not sure if this is sometimes failing, or
// what happens when it finds one much further up the tree. Maybe jest then
// tries to resolve the preset in *that* directory. Anyway, to make things as
// easy for it as possible, I updated the testing package build script to put a
// package.json files in the preset directories for both the api and the web
// sides. And after that CI passed.
// But since it's been flakey I don't know if this was the actual fix, or if it
// just randomly decided to pass.
fs.writeFileSync(
  './config/jest/api/package.json',
  JSON.stringify(
    {
      name: 'cedarjs-jest-api-preset',
      version: '0.0.1',
      type: 'commonjs',
      main: 'index.js',
      license: 'MIT',
      types: './index.d.ts',
    },
    null,
    2,
  ),
)
fs.writeFileSync(
  './config/jest/web/package.json',
  JSON.stringify(
    {
      name: 'cedarjs-jest-web-preset',
      version: '0.0.1',
      type: 'commonjs',
      main: 'index.js',
      license: 'MIT',
      types: './index.d.ts',
    },
    null,
    2,
  ),
)

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

// ./src/web/globRoutesImporter.ts contains `import.meta.glob`. This is not
// supported in CJS. And for CJS we don't really use this, but it does get
// imported and executed, so we need to mock it. esbuild will just make
// `import.meta` be an empty object, but that's not quite enough for what we
// need here, so I extend it a bit more.
const globRoutesImporterBuildPath = './dist/cjs/web/globRoutesImporter.js'
const globRoutesImporterFile = fs.readFileSync(
  globRoutesImporterBuildPath,
  'utf-8',
)

fs.writeFileSync(
  globRoutesImporterBuildPath,
  globRoutesImporterFile.replaceAll(
    'const import_meta = {};',
    'const import_meta = { glob: () => ({ "routes.tsx": () => null }) };',
  ),
)

// Verify that required directories exist
function verifyDirectoryExists(dirPath: string, description: string) {
  if (!fs.existsSync(dirPath)) {
    console.error(`ERROR: ${description} directory does not exist: ${dirPath}`)
    process.exit(1)
  }
  console.log(`✓ ${description} directory exists: ${dirPath}`)
}

console.log('\nVerifying build output directories...')
verifyDirectoryExists('./dist', 'Main dist')
verifyDirectoryExists('./config', 'Config')
verifyDirectoryExists('./dist/cjs', 'CJS dist')
verifyDirectoryExists('./dist/cjs/config', 'CJS config')

console.log('✓ All required directories verified successfully')
