import { buildEsm, copyAssets } from '@cedarjs/framework-tools'
import { generateTypesEsm } from '@cedarjs/framework-tools/generateTypes'

await buildEsm()
await generateTypesEsm()

await copyAssets({
  buildFileUrl: import.meta.url,
  patterns: ['generate/templates/**/*.template'],
})
