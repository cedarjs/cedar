import {
  build,
  defaultBuildOptions,
  defaultIgnorePatterns,
} from '@cedarjs/framework-tools'

// Build the package
await build({
  entryPointOptions: {
    ignore: [...defaultIgnorePatterns, './src/bin.ts', './src/types.ts'],
  },
})

// Build the bin
await build({
  buildOptions: {
    ...defaultBuildOptions,
    banner: {
      js: '#!/usr/bin/env node',
    },
    bundle: true,
    entryPoints: ['./src/bin.ts'],
    packages: 'external',
  },
  metafileName: 'meta.bin.json',
})
