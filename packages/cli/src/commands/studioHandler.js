import fs from 'node:fs'
import path from 'node:path'

import semver from 'semver'

import { getPaths } from '@cedarjs/project-config'

import { isModuleInstalled, installModule } from '../lib/packages.js'

export const handler = async (options) => {
  try {
    // Check the module is installed
    if (!isModuleInstalled('@cedarjs/studio')) {
      const minVersions = ['7.0.0-canary.889', '7.x', '8.0.0-0']
      assertRedwoodVersion(minVersions)

      console.log(
        'The studio package is not installed, installing it for you, this may take a moment...',
      )
      await installModule('@cedarjs/studio', '12')
      console.log('Studio package installed successfully.')

      const installedRealtime = await installModule('@cedarjs/realtime')
      if (installedRealtime) {
        console.log(
          "Added @cedarjs/realtime to your project, as it's used by Studio",
        )
      }

      const installedApiServer = await installModule('@cedarjs/api-server')
      if (installedApiServer) {
        console.log(
          "Added @cedarjs/api-server to your project, as it's used by Studio",
        )
      }
    }

    // Import studio and start it
    const { serve } = await import('@cedarjs/studio')
    await serve({ open: options.open, enableWeb: true })
  } catch (e) {
    console.log('Cannot start the development studio')
    console.log(e)
    process.exit(1)
  }
}

// Exported for unit testing
export function assertRedwoodVersion(minVersions) {
  const rwVersion = getProjectRedwoodVersion()
  const coercedRwVersion = semver.coerce(rwVersion)

  if (
    minVersions.some((minVersion) => {
      // Have to do this to handle pre-release versions until
      // https://github.com/npm/node-semver/pull/671 is merged
      const v = semver.valid(minVersion) || semver.coerce(minVersion)

      const coercedMin = semver.coerce(minVersion)

      // According to semver 1.0.0-rc.X > 1.0.0-canary.Y (for all values of X
      // and Y)
      // But for Redwood an RC release can be much older than a Canary release
      // (and not contain features from Canary that whoever calls this need)
      // Because RW doesn't 100% follow SemVer for pre-releases we have to
      // have some custom logic here
      return (
        semver.gte(rwVersion, v) &&
        (coercedRwVersion.major === coercedMin.major
          ? semver.prerelease(rwVersion)?.[0] === semver.prerelease(v)?.[0]
          : true)
      )
    })
  ) {
    // All good, the user's RW version meets at least one of the minimum
    // version requirements
    return
  }

  console.error(
    `The studio command requires Redwood version ${minVersions[0]} or ` +
      `greater, you are using ${rwVersion}.`,
  )

  process.exit(1)
}

function getProjectRedwoodVersion() {
  const { devDependencies } = JSON.parse(
    fs.readFileSync(path.join(getPaths().base, 'package.json'), 'utf-8'),
  )

  return devDependencies['@cedarjs/core']
}
