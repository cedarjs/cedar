import { buildCjs, buildEsm } from '@cedarjs/framework-tools'
import {
  generateTypesCjs,
  generateTypesEsm,
  insertCommonJsPackageJson,
} from '@cedarjs/framework-tools/generateTypes'

await buildEsm()
await generateTypesEsm()

await buildCjs()
await generateTypesCjs()

await insertCommonJsPackageJson({ buildFileUrl: import.meta.url })
