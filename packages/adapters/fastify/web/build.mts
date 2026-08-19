import { build, defaultBuildOptions } from '@cedarjs/framework-tools'
import { generateTypesEsm } from '@cedarjs/framework-tools/generateTypes'

// Build the main entry point
await build({
  buildOptions: {
    ...defaultBuildOptions,
    tsconfig: 'tsconfig.build.json',
    format: 'esm',
    bundle: true,
    entryPoints: ['./src/web.ts'],
    packages: 'external',
  },
})

// Build the helpers entry point
await build({
  buildOptions: {
    ...defaultBuildOptions,
    tsconfig: 'tsconfig.build.json',
    format: 'esm',
    entryPoints: ['./src/helpers.ts'],
  },
})

await generateTypesEsm()
