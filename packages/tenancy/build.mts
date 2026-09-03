import { build, defaultBuildOptions } from '@cedarjs/framework-tools'
import { generateTypesEsm } from '@cedarjs/framework-tools/generateTypes'

// ESM build
await build({
  buildOptions: {
    ...defaultBuildOptions,
    format: 'esm',
    packages: 'external',
  },
})

await generateTypesEsm()
