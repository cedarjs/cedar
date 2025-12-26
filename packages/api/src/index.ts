import { createRequire } from 'node:module'

export * from './auth/index.js'
export * from './errors.js'
export * from './validations/validations.js'
export * from './validations/errors.js'
export * from './types.js'
export * from './transforms.js'
export * from './cors.js'
export * from './event.js'

// Use native `require` for CJS builds, and create a require function with the
// base dir set to the dir of this file for ESM builds
const customRequire =
  // Look out for a stubbed require function (@rollup will stub it)
  // @ts-expect-error - Using `0, ` to work around bundler magic
  typeof require === 'function' && !(0, require).toString().includes('@rollup')
    ? require
    : createRequire(import.meta.url)

const cedarApiPath = customRequire.resolve('@cedarjs/api')
const cedarApiRequire = createRequire(cedarApiPath)

let packageJson = cedarApiRequire('./package.json')

// Because of how we build the package we might have to walk up the directory
// tree a few times to find the correct package.json file
if (packageJson?.name !== '@cedarjs/api') {
  packageJson = cedarApiRequire('../package.json')
}

if (packageJson?.name !== '@cedarjs/api') {
  packageJson = cedarApiRequire('../../package.json')
}

export const prismaVersion = packageJson?.dependencies['@prisma/client']
export const redwoodVersion = packageJson?.version
export const cedarjsVersion = packageJson?.version
