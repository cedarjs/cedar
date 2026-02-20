import { buildExternalCjs, buildExternalEsm } from '@cedarjs/framework-tools'
import {
  generateTypesCjs,
  generateTypesEsm,
  insertCommonJsPackageJson,
} from '@cedarjs/framework-tools/generateTypes'

await buildExternalEsm()
await generateTypesEsm()

await buildExternalCjs()
await generateTypesCjs()

await insertCommonJsPackageJson({ buildFileUrl: import.meta.url })
