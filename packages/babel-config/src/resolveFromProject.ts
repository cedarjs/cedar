import { createRequire } from 'node:module'
import path from 'node:path'

import type * as BabelCore from '@babel/core'

import { getPaths } from '@cedarjs/project-config'

/**
 * The packages a project has to install in its api workspace to use a custom
 * `api/babel.config.js`. They are optional peer dependencies of
 * `@cedarjs/babel-config`, so projects without a custom config never pay for
 * them.
 */
export const API_BABEL_CONFIG_PACKAGES = [
  '@babel/core',
  '@babel/preset-typescript',
] as const

/**
 * The Babel major Cedar's api-side config is written for. The
 * `@babel/preset-typescript` options Cedar passes (`isTSX`, `allExtensions`)
 * only exist in this major.
 */
export const SUPPORTED_BABEL_MAJOR = 7

const INSTALL_COMMAND = `yarn workspace api add -D ${API_BABEL_CONFIG_PACKAGES.map(
  (packageName) => `${packageName}@^${SUPPORTED_BABEL_MAJOR}`,
).join(' ')}`

/**
 * Builds the error thrown when `api/babel.config.js` exists but one of the
 * packages it needs is missing from the project.
 */
export function getMissingApiBabelPackageMessage(packageName: string) {
  return (
    `api/babel.config.js was found, but ${packageName} is not installed. ` +
    'Custom Babel configuration for the api side needs ' +
    `${API_BABEL_CONFIG_PACKAGES.join(' and ')}: run \`${INSTALL_COMMAND}\`.`
  )
}

/**
 * Builds the error thrown when `api/babel.config.js` exists but the installed
 * package is from a Babel major Cedar's api-side config doesn't support.
 */
export function getUnsupportedApiBabelVersionMessage(
  packageName: string,
  version: string,
) {
  return (
    `api/babel.config.js was found, but the installed ${packageName} ` +
    `(${version}) is not supported. Custom Babel configuration for the api ` +
    `side needs ${API_BABEL_CONFIG_PACKAGES.join(' and ')} ` +
    `${SUPPORTED_BABEL_MAJOR}.x: run \`${INSTALL_COMMAND}\`.`
  )
}

/**
 * Returns a `require` rooted in the project's api workspace. Node walks from
 * `api/node_modules` up to the project root, so both workspace-local and
 * hoisted installs are found.
 */
function createProjectRequire() {
  return createRequire(path.join(getPaths().api.base, 'package.json'))
}

function assertSupportedMajor(packageName: string, resolvedPath: string) {
  // Requiring from the resolved file's own location guarantees the
  // package.json belongs to the same copy of the package that was resolved.
  const packageJson: unknown = createRequire(resolvedPath)(
    `${packageName}/package.json`,
  )

  const version =
    typeof packageJson === 'object' &&
    packageJson !== null &&
    'version' in packageJson &&
    typeof packageJson.version === 'string'
      ? packageJson.version
      : undefined

  if (version && Number(version.split('.')[0]) !== SUPPORTED_BABEL_MAJOR) {
    throw new Error(getUnsupportedApiBabelVersionMessage(packageName, version))
  }
}

/**
 * Resolves `packageName` to an absolute path from the project's api
 * workspace. Throws an actionable error when the package isn't installed
 * there (so the failure mode is the same no matter how the package manager
 * laid out `node_modules`) or when it's from an unsupported Babel major.
 */
export function resolveFromProject(packageName: string) {
  const projectRequire = createProjectRequire()

  let resolvedPath: string

  try {
    resolvedPath = projectRequire.resolve(packageName)
  } catch {
    throw new Error(getMissingApiBabelPackageMessage(packageName))
  }

  assertSupportedMajor(packageName, resolvedPath)

  return resolvedPath
}

/**
 * Loads the project's copy of `@babel/core`. Resolving from the project
 * rather than from this package keeps `@babel/core` out of projects that
 * don't use `api/babel.config.js`.
 */
export function loadBabelCoreFromProject(): typeof BabelCore {
  // `@babel/core` is CommonJS; `require` gives a synchronous load with the
  // same module shape a static import would have.
  return createProjectRequire()(resolveFromProject('@babel/core'))
}
