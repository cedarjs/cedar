export * from './auth/index.js'
export * from './errors.js'
export * from './validations/validations.js'
export * from './validations/errors.js'
export * from './types.js'
export * from './transforms.js'
export * from './cors.js'
export * from './event.js'

// @cedarjs/api's version is injected at compile time by esbuild's `define`
// option in build.mts (applied to both CJS and ESM builds). This avoids a
// runtime filesystem lookup for package.json, which is critical when the
// package is bundled into a Vercel serverless function where
// node_modules/@cedarjs/api doesn't exist on disk.
declare const __CEDAR_API_VERSION__: string
declare const __PRISMA_CLIENT_VERSION__: string | undefined

export const prismaVersion: string | undefined = __PRISMA_CLIENT_VERSION__
/** @deprecated - use `cedarVersion` instead */
export const redwoodVersion = __CEDAR_API_VERSION__
/** @deprecated - use `cedarVersion` instead */
export const cedarjsVersion = __CEDAR_API_VERSION__
export const cedarVersion = __CEDAR_API_VERSION__
