import { build, buildCjs, defaultBuildOptions } from '@cedarjs/framework-tools'
import {
  generateTypesCjs,
  generateTypesEsm,
  insertCommonJsPackageJson,
} from '@cedarjs/framework-tools/generateTypes'

await build({
  buildOptions: {
    ...defaultBuildOptions,
    tsconfig: 'tsconfig.build.json',
    format: 'esm',
  },
  entryPointOptions: {
    ignore: [
      '**/__tests__',
      '**/*.test.{ts,js}',
      '**/__fixtures__',
      '**/testUtils',
      '**/__testfixtures__',
      '**/__typetests__',
      'src/runPrerender.tsx',
      'src/index.ts',
    ],
  },
})
await generateTypesEsm()

await buildCjs()
await generateTypesCjs()
await insertCommonJsPackageJson({
  buildFileUrl: import.meta.url,
})
