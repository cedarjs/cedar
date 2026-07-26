import { buildEsm } from '@cedarjs/framework-tools'
import { generateTypesEsm } from '@cedarjs/framework-tools/generateTypes'

await buildEsm()
await generateTypesEsm()
