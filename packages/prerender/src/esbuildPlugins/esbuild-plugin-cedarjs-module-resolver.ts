import path from 'node:path'

import type { Plugin } from 'esbuild'

import { getPaths } from '@cedarjs/project-config'

import {
  getNewPath,
  getPathsFromTypeScriptConfig,
  parseTypeScriptConfigFiles,
} from './helpers'

export function cedarjsModuleResolverPlugin(options?: {
  alias?: Record<string, string>
}): Plugin {
  // Get the TS configs in the api and web sides as an object
  const tsConfigs = parseTypeScriptConfigFiles()

  const webBase = getPaths().web.base
  const apiBase = getPaths().api.base

  const alias = options?.alias || {
    src: path.resolve(webBase, 'src'),
    // adds the paths from [ts|js]config.json to the module resolver
    ...Object.fromEntries(
      Object.entries(getPathsFromTypeScriptConfig(tsConfigs.web, webBase)).map(
        ([key, value]) => [key, path.resolve(webBase, value)],
      ),
    ),
    $api: apiBase,
  }

  return {
    name: 'cedarjs-module-resolver',
    setup(build) {
      Object.entries(alias).forEach(([key, value]) => {
        build.onResolve({ filter: new RegExp(`^${key}(/.*)?$`) }, (args) => {
          console.log('resolving for args.path', args.path)
          console.log('resolving for key', key)
          console.log('resolving for value', value)

          const relativePath = args.path.slice(key.length)
          let absolutePath = path.resolve(value + relativePath)

          console.log('resolving for relativePath', relativePath)
          console.log('resolving for absolutePath', absolutePath)

          if (!absolutePath.endsWith('.ts') && !absolutePath.endsWith('.tsx')) {
            console.log('trying to get new path with importer', args.importer)
            const newPath = getNewPath(absolutePath, args.importer)

            if (newPath) {
              absolutePath = newPath
            }
          }

          return {
            path: absolutePath,
            external: false,
          }
        })
      })
    },
  }
}
