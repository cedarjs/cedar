import { buildEsm, copyAssets } from '@cedarjs/framework-tools'
import { generateTypesEsm } from '@cedarjs/framework-tools/generateTypes'

await buildEsm()

await copyAssets({
  buildFileUrl: import.meta.url,
  patterns: ['templates/**/*.template'],
})

await generateTypesEsm()
