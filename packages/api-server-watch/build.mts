import {
  build,
  defaultBuildOptions,
  defaultIgnorePatterns,
} from '@cedarjs/framework-tools'
import { generateTypesEsm } from '@cedarjs/framework-tools/generateTypes'

// Build the main package as ESM (everything except the bin.ts entry point,
// which is bundled separately below)
await build({
  buildOptions: {
    ...defaultBuildOptions,
    tsconfig: 'tsconfig.build.json',
    format: 'esm',
    packages: 'external',
  },
  entryPointOptions: {
    ignore: [...defaultIgnorePatterns, './src/bin.ts'],
  },
})
await generateTypesEsm()

// Build the cedar-api-server-watch bin
await build({
  buildOptions: {
    ...defaultBuildOptions,
    tsconfig: 'tsconfig.build.json',
    format: 'esm',
    banner: {
      js: '#!/usr/bin/env node',
    },
    bundle: true,
    packages: 'external',
    entryPoints: ['./src/bin.ts'],
  },
  metafileName: 'meta.esm.bin.json',
})
