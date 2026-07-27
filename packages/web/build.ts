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
    ],
  },
  buildOptions: {
    ...defaultBuildOptions,
    tsconfig: 'tsconfig.build.json',
    format: 'esm',
    packages: 'external',
  },
})

await generateTypesEsm()
