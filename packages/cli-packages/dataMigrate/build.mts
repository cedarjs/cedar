import {
  build,
  defaultBuildOptions,
  defaultIgnorePatterns,
} from '@cedarjs/framework-tools'
import { generateTypesEsm } from '@cedarjs/framework-tools/generateTypes'

// Build the package
await build({
  buildOptions: {
    ...defaultBuildOptions,
    tsconfig: 'tsconfig.build.json',
    format: 'esm',
  },
  entryPointOptions: {
    ignore: [...defaultIgnorePatterns, './src/types.ts', './src/bin.ts'],
  },
})

// Build the bin
await build({
  buildOptions: {
    ...defaultBuildOptions,
    tsconfig: 'tsconfig.build.json',
    format: 'esm',
    banner: {
      js: '#!/usr/bin/env node',
    },
    bundle: true,
    entryPoints: ['./src/bin.ts'],
    minify: true,
    packages: 'external',
  },
  metafileName: 'meta.bin.json',
})

await generateTypesEsm()
