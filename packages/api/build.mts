import fs from 'node:fs'

import {
  build,
  defaultBuildOptions,
  defaultIgnorePatterns,
} from '@cedarjs/framework-tools'

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8')) as {
  version: string
  dependencies: Record<string, string>
}

if (!pkg.version) {
  throw new Error('build error: No version specified')
}
if (!pkg.dependencies['@prisma/client']) {
  throw new Error('build error: @prisma/client is not available')
}

// Some comments I wish I had a better place for...
//  - The `exports` field in package.json must have the "types" condition first
//    See the end of this section:
//      https://devblogs.microsoft.com/typescript/announcing-typescript-4-7/#package.json-exports-imports-and-self-referencing
//  - We specify `tsBuildInfoFile` for `tsconfig.cjs.json` because otherwise
//    it'd be placed inside ./dist/ (because outDir is dist/cjs and the default
//    is to place it at one level up from outDir).

await build({
  buildOptions: {
    ...defaultBuildOptions,
    tsconfig: 'tsconfig.cjs.json',
    outdir: 'dist/cjs',
    packages: 'external',
    define: {
      __CEDAR_API_VERSION__: JSON.stringify(pkg.version),
      __PRISMA_CLIENT_VERSION__: JSON.stringify(
        pkg.dependencies['@prisma/client'],
      ),
    },
  },
})
await build({
  entryPointOptions: {
    // NOTE: building the bins as CJS only so they can still use
    // require.resolve()
    ignore: [...defaultIgnorePatterns, 'src/bins/**'],
  },
  buildOptions: {
    ...defaultBuildOptions,
    tsconfig: 'tsconfig.build.json',
    format: 'esm',
    packages: 'external',
    define: {
      __CEDAR_API_VERSION__: JSON.stringify(pkg.version),
      __PRISMA_CLIENT_VERSION__: JSON.stringify(
        pkg.dependencies?.['@prisma/client'],
      ),
    },
  },
})

// Place a package.json file with `type: commonjs` in the dist/cjs folder so
// that all .js files are treated as CommonJS files.
fs.writeFileSync('dist/cjs/package.json', JSON.stringify({ type: 'commonjs' }))

// Place a package.json file with `type: module` in the dist folder so that
// all .js files are treated as ES Module files.
fs.writeFileSync('dist/package.json', JSON.stringify({ type: 'module' }))
