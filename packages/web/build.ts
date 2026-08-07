import * as esbuild from 'esbuild'

import {
  build,
  defaultBuildOptions,
  defaultIgnorePatterns,
} from '@cedarjs/framework-tools'
import { generateTypesEsm } from '@cedarjs/framework-tools/generateTypes'

await build({
  entryPointOptions: {
    ignore: [
      ...defaultIgnorePatterns,
      // defaultIgnorePatterns only covers .test.{ts,js}, so also ignore the
      // .tsx test files to keep them out of the build output
      '**/*.test.tsx',
      'src/__typetests__/**',
      'src/bundled/**', // <-- ⭐
    ],
  },
  buildOptions: {
    ...defaultBuildOptions,
    tsconfig: 'tsconfig.build.json',
    format: 'esm',
    packages: 'external',
  },
})

// apollo-upload-client (and its own transitive deps, e.g. extract-files ->
// is-plain-obj) ship real ESM. That's fine for this package's own build, but
// once a generated project's Jest run pulls in @cedarjs/web (see ⭐ above --
// web is in the web-side Jest preset's transformIgnorePatterns carve-out),
// Jest's CJS runtime would need every one of those transitive node_modules
// files individually carved out too, and that list isn't ours to maintain --
// it's whatever apollo-upload-client's own dependency tree happens to be at
// any given version. Bundling this one file inlines the whole chain into a
// single self-contained module, so nothing outside of it needs its own
// carve-out entry.
await esbuild.build({
  entryPoints: ['src/bundled/*'],
  outdir: 'dist/bundled',
  format: 'esm',
  bundle: true,
  logLevel: 'info',
  tsconfig: 'tsconfig.build.json',
})

await generateTypesEsm()
