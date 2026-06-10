import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

export * from './auth/index.js'
export * from './errors.js'
export * from './validations/validations.js'
export * from './validations/errors.js'
export * from './types.js'
export * from './transforms.js'
export * from './cors.js'
export * from './event.js'

// Locate the package.json for @cedarjs/api.
//
// We use import.meta.resolve (ESM, uses the import export condition) to find
// the package entry point URL, then derive the package root from that path.
// This is correct both when this file is loaded directly from node_modules AND
// when it has been inlined by esbuild into a UD handler bundle - in the latter
// case import.meta.dirname would point to the bundle file rather than the
// @cedarjs/api package dir, but import.meta.resolve always resolves relative
// to this source file's original URL regardless of bundling.
//
// In the CJS build the bundler replaces import.meta with {}, so we fall back
// to the CJS globals __dirname and __filename.

type PackageJson = {
  name?: string
  version?: string
  dependencies?: Record<string, string>
}

let packageJson: PackageJson | undefined
let importMetaError: Error | undefined

// @ts-expect-error - import.meta is replaced with {} in CJS build, so .resolve
// is undefined, but TS's typings declare it as always present
if (import.meta.resolve) {
  try {
    const cedarApiEntryUrl = import.meta.resolve('@cedarjs/api')
    const cedarApiDir = fileURLToPath(new URL('.', cedarApiEntryUrl))
    const cedarApiRequire = createRequire(cedarApiEntryUrl)
    packageJson = cedarApiRequire(`${cedarApiDir}/package.json`)

    if (packageJson?.name !== '@cedarjs/api') {
      packageJson = cedarApiRequire(`${cedarApiDir}../package.json`)
    }
  } catch (error) {
    // If the code above fails for whatever reason, I want to try the
    // `createRequire` fallback below.
    importMetaError = error instanceof Error ? error : new Error(String(error))
  }
}

if (!packageJson) {
  try {
    const cedarApiRequire = createRequire(__filename)
    packageJson = cedarApiRequire(`${__dirname}/package.json`)

    if (packageJson?.name !== '@cedarjs/api') {
      packageJson = cedarApiRequire(`${__dirname}/../package.json`)
    }

    if (packageJson?.name !== '@cedarjs/api') {
      packageJson = cedarApiRequire(`${__dirname}/../../package.json`)
    }
  } catch (error) {
    throw new Error(
      'Could not read package.json to determine package version',
      { cause: importMetaError ?? error },
    )
  }
}

export const prismaVersion = packageJson?.dependencies?.['@prisma/client']
/** @deprecated - use `cedarVersion` instead */
export const redwoodVersion = packageJson?.version
/** @deprecated - use `cedarVersion` instead */
export const cedarjsVersion = packageJson?.version
export const cedarVersion = packageJson?.version
