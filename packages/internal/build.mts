import {
  buildEsm,
  build,
  copyAssets,
  defaultBuildOptions,
} from '@cedarjs/framework-tools'
import {
  generateTypesCjs,
  generateTypesEsm,
  insertCommonJsPackageJson,
} from '@cedarjs/framework-tools/generateTypes'

await buildEsm()
await generateTypesEsm()

await build({
  buildOptions: {
    ...defaultBuildOptions,
    tsconfig: 'tsconfig.cjs.json',
    outdir: 'dist/cjs',
    logOverride: {
      // We need this for ./src/generate/templates.ts
      'empty-import-meta': 'silent',
    },
  },
})
await generateTypesCjs()

await insertCommonJsPackageJson({ buildFileUrl: import.meta.url })

await copyAssets({
  buildFileUrl: import.meta.url,
  patterns: ['generate/templates/**/*.template'],
})

await copyAssets({
  buildFileUrl: import.meta.url,
  patterns: ['generate/templates/**/*.template'],
  cjs: true,
})
