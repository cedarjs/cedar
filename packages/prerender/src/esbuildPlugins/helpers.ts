import fs from 'node:fs'
import path from 'node:path'

import { parseConfigFileTextToJson } from 'typescript'

import { getPaths, resolveFile } from '@cedarjs/project-config'

export function getNewPath(importPath: string, importer: string) {
  const dirname = path.dirname(importPath)
  const basename = path.basename(importPath)

  // We try to resolve `index.[js*|ts*]` modules first,
  // since that's the desired default behaviour
  const indexImportPath = [dirname, basename, 'index'].join('/')
  console.log('getNewPath indexImportPath', indexImportPath)
  const resolvedIndexPath = path.resolve(
    path.dirname(importer),
    indexImportPath,
  )

  if (resolveFile(resolvedIndexPath)) {
    return indexImportPath
  } else {
    // No index file found, so try to import the directory-named-module instead
    const dirnameImportPath = [dirname, basename, basename].join('/')
    console.log('getNewPath dirnameImportPath', dirnameImportPath)
    const resolvedDirnamePath = path.resolve(
      path.dirname(importer),
      dirnameImportPath,
    )
    console.log('getNewPath resolvedDirnamePath', resolvedDirnamePath)

    const resolvedFile = resolveFile(resolvedDirnamePath)
    if (resolvedFile) {
      return resolvedFile
    }
  }

  return null
}

/**
 * Finds, reads and parses the [ts|js]config.json file
 * @returns The config object
 */
export const parseTypeScriptConfigFiles = () => {
  const rwPaths = getPaths()

  const parseConfigFile = (basePath: string) => {
    let configPath = path.join(basePath, 'tsconfig.json')
    if (!fs.existsSync(configPath)) {
      configPath = path.join(basePath, 'jsconfig.json')
      if (!fs.existsSync(configPath)) {
        return null
      }
    }
    return parseConfigFileTextToJson(
      configPath,
      fs.readFileSync(configPath, 'utf-8'),
    )
  }
  const apiConfig = parseConfigFile(rwPaths.api.base)
  const webConfig = parseConfigFile(rwPaths.web.base)

  return {
    api: apiConfig?.config ?? null,
    web: webConfig?.config ?? null,
  }
}

type CompilerOptionsForPaths = {
  compilerOptions: { baseUrl: string; paths: Record<string, string[]> }
}

/**
 * Extracts and formats the paths from the [ts|js]config.json file
 * @param config The config object
 * @param rootDir {string} Where the jsconfig/tsconfig is loaded from
 * @returns {Record<string, string>} The paths object
 */
export const getPathsFromTypeScriptConfig = (
  config: CompilerOptionsForPaths,
  rootDir: string,
): Record<string, string> => {
  if (!config) {
    return {}
  }

  if (!config.compilerOptions?.paths) {
    return {}
  }

  const { baseUrl, paths } = config.compilerOptions

  let absoluteBase: string
  if (baseUrl) {
    // Convert it to absolute path - on windows the baseUrl is already absolute
    absoluteBase = path.isAbsolute(baseUrl)
      ? baseUrl
      : path.join(rootDir, baseUrl)
  } else {
    absoluteBase = rootDir
  }

  const pathsObj: Record<string, string> = {}
  for (const [key, value] of Object.entries(paths)) {
    // exclude the default paths that are included in the tsconfig.json file
    // "src/*"
    // "$api/*"
    // "types/*"
    // "@cedarjs/testing"
    if (key.match(/src\/|\$api\/\*|types\/\*|\@cedarjs\/.*/g)) {
      continue
    }
    const aliasKey = key.replace('/*', '')
    const aliasValue = path.join(absoluteBase, value[0].replace('/*', ''))

    pathsObj[aliasKey] = aliasValue
  }
  return pathsObj
}
