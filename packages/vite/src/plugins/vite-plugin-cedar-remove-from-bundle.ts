import fs from 'node:fs'
import path from 'node:path'

import type { Plugin } from 'vite'

import { getPaths } from '@cedarjs/project-config'

type ModulesToExclude = { id: RegExp; exportNames?: string[] }[]

/**
 * This is a vite plugin to remove modules from the bundle.
 *
 * Only applies on build, not on dev.
 */
export function cedarRemoveFromBundle(): Plugin {
  // If realtime is enabled, we want to include the sseLink in the bundle.
  // Right now the only way we have of telling is if the package is installed on
  // the api side.
  const apiPackageJsonPath = path.join(getPaths().api.base, 'package.json')
  const realtimeEnabled =
    fs.existsSync(apiPackageJsonPath) &&
    fs.readFileSync(apiPackageJsonPath, 'utf-8').includes('@cedarjs/realtime')

  const modulesToExclude: ModulesToExclude = [
    {
      id: /@cedarjs\/router\/dist\/splash-page/,
      exportNames: ['SplashPage'],
    },
  ]

  if (!realtimeEnabled) {
    modulesToExclude.push({
      id: /@cedarjs\/web\/dist\/apollo\/sseLink/,
    })
  }

  return {
    name: 'remove-from-bundle',
    apply: 'build',
    load: (id) => {
      return excludeOnMatch(modulesToExclude, id)
    },
  }
}

function generateModuleWithExports(exportNames: string[]) {
  return {
    code: `export default {}; ${exportNames.map((name) => `export const ${name} = undefined;`).join('\n')}`,
  }
}

export function excludeOnMatch(modulesToExclude: ModulesToExclude, id: string) {
  const moduleToExclude = modulesToExclude.find((module) => module.id.test(id))

  if (moduleToExclude) {
    return generateModuleWithExports(moduleToExclude.exportNames || [])
  }

  // Fallback to regular loaders
  return null
}
