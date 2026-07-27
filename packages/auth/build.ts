import { buildExternalEsm } from '@cedarjs/framework-tools'
import { generateTypesEsm } from '@cedarjs/framework-tools/generateTypes'

await buildExternalEsm()
await generateTypesEsm()
