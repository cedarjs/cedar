import { buildExternalEsm, buildExternalCjs } from '@cedarjs/framework-tools'
import {
  generateTypesCjs,
  generateTypesEsm,
  insertCommonJsPackageJson,
} from '@cedarjs/framework-tools/generateTypes'

// ESM build and type generation
await buildExternalEsm()
await generateTypesEsm()

// CJS build, type generation, and package.json insert
await buildExternalCjs()
await generateTypesCjs()
await insertCommonJsPackageJson({
  buildFileUrl: import.meta.url,
})
