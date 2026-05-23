import { createRequire } from 'node:module'

export * from './auth/index.js'
export * from './errors.js'
export * from './validations/validations.js'
export * from './validations/errors.js'
export * from './types.js'
export * from './transforms.js'
export * from './cors.js'
export * from './event.js'

// Locate the package.json of @cedarjs/api by walking up from this file's
// directory. Because of how we nest cjs and esm build output we have to walk
// up one or two levels to find the correct package.json file

const currentDir = import.meta.dirname ?? __dirname
const cedarApiRequire = createRequire(import.meta.url ?? __filename)

let packageJson = cedarApiRequire(`${currentDir}/package.json`)

if (packageJson?.name !== '@cedarjs/api') {
  packageJson = cedarApiRequire(`${currentDir}/../package.json`)
}

if (packageJson?.name !== '@cedarjs/api') {
  packageJson = cedarApiRequire(`${currentDir}/../../package.json`)
}

export const prismaVersion = packageJson?.dependencies['@prisma/client']
/** @deprecated - use `cedarVersion` instead */
export const redwoodVersion = packageJson?.version
/** @deprecated - use `cedarVersion` instead */
export const cedarjsVersion = packageJson?.version
export const cedarVersion = packageJson?.version
