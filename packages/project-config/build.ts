import fs from 'node:fs'

import { build, defaultBuildOptions } from '@cedarjs/framework-tools'

// ESM build
await build({
  buildOptions: {
    ...defaultBuildOptions,
    bundle: true,
    entryPoints: ['./src/index.ts'],
    format: 'esm',
    packages: 'external',
  },
})

// CJS build
await build({
  buildOptions: {
    ...defaultBuildOptions,
    bundle: true,
    entryPoints: ['./src/index.ts'],
    outdir: 'dist/cjs',
    packages: 'external',
  },
})

// Place a package.json file with `type: commonjs` in the dist/cjs folder so
// that all .js files are treated as CommonJS files.
fs.writeFileSync('dist/cjs/package.json', JSON.stringify({ type: 'commonjs' }))

// Place a package.json file with `type: module` in the dist folder so that
// all .js files are treated as ES Module files.
fs.writeFileSync('dist/package.json', JSON.stringify({ type: 'module' }))

// ./src/prisma.ts contains `... = await import(prismaConfigPath)`. When
// building for CJS esbuild correctly preserves the `await import` statement
// because it's valid in both CJS and ESM (whereas regular `import`s are only
// valid in ESM).
// The problem is that this file will be consumed by Jest, and jest doesn't
// support that syntax. They only support `require()`.
// That's why we have to do manual editing of built files here.
// Also note that we're asking esbuild to bundle files, so the prisma.ts file
// will be bundled into index.js.
// TODO: Remove this once we go ESM-only
const indexBuildPath = './dist/cjs/index.js'
const indexFile = fs.readFileSync(indexBuildPath, 'utf-8')
fs.writeFileSync(
  indexBuildPath,
  indexFile
    .replace('await import(configUrl)', 'require(prismaConfigPath)')
    .replace(
      'const { createSchemaPathInput, getSchemaWithPath } = await import("@prisma/internals")',
      'const { createSchemaPathInput, getSchemaWithPath } = require("@prisma/internals")',
    )
    .replace(
      // The "3" in getConfig3 is from esbuild renaming the import to avoid a
      // conflict. If this changes between builds we'll have to use a regexp
      // here instead to be more flexible in what we match
      'const { getConfig: getConfig3 } = await import("@prisma/internals")',
      'const { getConfig: getConfig3 } = require("@prisma/internals")',
    ),
)
