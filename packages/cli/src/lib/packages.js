import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import execa from 'execa'

import { getPaths } from './index.js'

// Note: Have to add backslash (\) before @ below for intellisense to display
// the doc comments properly
/**
 * Installs a module into a user's project. If the module is already installed,
 * this function does nothing. If no version is specified, the version will be
 * assumed to be the same as that of \@cedarjs/cli.
 *
 * @param {string} name The name of the module to install
 * @param {string} version The version of the module to install, otherwise the same as that of \@cedarjs/cli
 * @param {boolean} isDevDependency Whether to install as a devDependency or not
 * @returns Whether the module was installed or not
 */
export async function installModule(name, version = undefined) {
  if (isModuleInstalled(name)) {
    return false
  }

  if (version === undefined) {
    return installRedwoodModule(name)
  } else {
    await execa.command(`yarn add -D ${name}@${version}`, {
      stdio: 'inherit',
      cwd: getPaths().base,
    })
  }

  return true
}

/**
 * Installs a Redwood module into a user's project keeping the version
 * consistent with that of \@cedarjs/cli.
 * If the module is already installed, this function does nothing.
 * If no remote version can not be found which matches the local cli version
 * then the latest canary version will be used.
 *
 * @param {string} module A redwoodjs module, e.g. \@cedarjs/web
 * @returns {boolean} Whether the module was installed or not
 */
export async function installRedwoodModule(module) {
  const packageJson = await import('@cedarjs/cli/package.json', {
    with: { type: 'json' },
  })
  let version = packageJson.default.version

  if (!isModuleInstalled(module)) {
    // If the version includes a plus, like '4.0.0-rc.428+dd79f1726'
    // (all @canary, @next, and @rc packages do), get rid of everything after the plus.
    if (version.includes('+')) {
      version = version.split('+')[0]
    }

    let packument

    try {
      const packumentResponse = await fetch(
        `https://registry.npmjs.org/${module}`,
      )

      packument = await packumentResponse.json()

      if (packument.error) {
        throw new Error(packument.error)
      }
    } catch (error) {
      throw new Error(
        `Couldn't fetch packument for ${module}: ${error.message}`,
      )
    }

    const versionIsPublished = Object.keys(packument.versions).includes(version)

    if (!versionIsPublished) {
      // Fallback to canary. This is most likely because it's a new package
      version = 'canary'
    }

    // We use `version` to make sure we install the same version as the rest
    // of the RW packages
    await execa.command(`yarn add -D ${module}@${version}`, {
      stdio: 'inherit',
      cwd: getPaths().base,
    })
    await execa.command(`yarn dedupe`, {
      stdio: 'inherit',
      cwd: getPaths().base,
    })
    return true
  }
  return false
}

/**
 * Check if a user's project's package.json has a module listed as a dependency
 * or devDependency. If not, check node_modules.
 *
 * @param {string} module
 */
export function isModuleInstalled(module) {
  const { dependencies, devDependencies } = JSON.parse(
    fs.readFileSync(path.join(getPaths().base, 'package.json'), 'utf-8'),
  )

  const deps = {
    ...dependencies,
    ...devDependencies,
  }

  if (deps[module]) {
    return true
  }

  const createdRequire = createRequire(import.meta.url)

  // Check any of the places require would look for this module.
  // This enables testing with `yarn cfw project:copy`.
  //
  // We can't use require.resolve here because it caches the exception
  // Making it impossible to require when we actually do install it...
  return createdRequire.resolve
    .paths(`${module}/package.json`)
    .some((requireResolvePath) => {
      return fs.existsSync(path.join(requireResolvePath, module))
    })
}
