import { writeFileSync } from 'node:fs'

import * as esbuild from 'esbuild'

import {
  build,
  defaultBuildOptions,
  defaultIgnorePatterns,
} from '@cedarjs/framework-tools'

// CJS build
/**
 * Note: We build bins in CJS, until projects fully switch to ESM or we produce
 * .mts files, which is probably the better option
 */
await build({
  entryPointOptions: {
    ignore: [
      ...defaultIgnorePatterns,
      'src/__typetests__/**',
      'src/bundled/**', // <-- ⭐
    ],
  },
  buildOptions: {
    ...defaultBuildOptions,
    tsconfig: 'tsconfig.build.json',
    outdir: 'dist/cjs',
    packages: 'external',
  },
})

// ESM build
await build({
  entryPointOptions: {
    // @NOTE: building the cjs bins only...
    // I haven't tried esm bins yet...
    ignore: [...defaultIgnorePatterns, 'src/bins/**', 'src/__typetests__/**'],
  },
  buildOptions: {
    ...defaultBuildOptions,
    tsconfig: 'tsconfig.build.json',
    format: 'esm',
    packages: 'external',
  },
})

// Workaround for apollo-client-upload being ESM-only
// In ESM version of rwjs/web, we don't actually bundle it, we just reexport.
// In the CJS version (see ⭐ above), we bundle it below.
// This only ever gets used during prerender, so bundle size is not a concern.
await esbuild.build({
  entryPoints: ['src/bundled/*'],
  outdir: 'dist/cjs/bundled',
  format: 'cjs',
  bundle: true,
  logLevel: 'info',
  tsconfig: 'tsconfig.build.json',
})

// Place a package.json file with `type: commonjs` in the dist/cjs folder so
// that all .js files are treated as CommonJS files.
writeFileSync('dist/cjs/package.json', JSON.stringify({ type: 'commonjs' }))

// Place a package.json file with `type: module` in the dist folder so that
// all .js files are treated as ES Module files.
writeFileSync('dist/package.json', JSON.stringify({ type: 'module' }))
