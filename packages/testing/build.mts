import fs from 'node:fs'

import { build, buildEsm, defaultBuildOptions } from '@cedarjs/framework-tools'
import {
  generateTypesCjs,
  generateTypesEsm,
  insertCommonJsPackageJson,
} from '@cedarjs/framework-tools/generateTypes'

// Verify that required directories exist
function verifyDirectoryExists(dirPath: string, description: string) {
  if (!fs.existsSync(dirPath)) {
    console.error(`ERROR: ${description} directory does not exist: ${dirPath}`)
    process.exit(1)
  }
  console.log(`✓ ${description} directory exists: ${dirPath}`)
}

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

console.log('\nVerifying build output directories...')
verifyDirectoryExists('./dist', 'Main dist')
verifyDirectoryExists('./dist/cjs', 'CJS dist')

console.log('✓ All required directories verified successfully')
