import fs from 'fs'
import path from 'path'

import { fetch } from '@whatwg-node/fetch'
import { parseConfigFileTextToJson } from 'typescript'

import { getConfig, getPaths } from '@cedarjs/project-config'

const INDEX_FILE = path.join(getPaths().web.dist, 'index.html')
const DEFAULT_INDEX = path.join(getPaths().web.dist, '200.html')

export const getRootHtmlPath = () => {
  if (fs.existsSync(DEFAULT_INDEX)) {
    return DEFAULT_INDEX
  } else {
    return INDEX_FILE
  }
}

export const registerShims = (routerPath: string) => {
  const rwjsConfig = getConfig()

  globalThis.RWJS_ENV = {
    RWJS_API_GRAPHQL_URL:
      rwjsConfig.web.apiGraphQLUrl ?? rwjsConfig.web.apiUrl + '/graphql',
    RWJS_API_URL: rwjsConfig.web.apiUrl,
    __REDWOOD__APP_TITLE: rwjsConfig.web.title,
  }

  globalThis.RWJS_DEBUG_ENV = {
    RWJS_SRC_ROOT: getPaths().web.src,
  }

  globalThis.__REDWOOD__PRERENDERING = true

  globalThis.__REDWOOD__HELMET_CONTEXT = {}

  // Let routes auto loader plugin know
  process.env.__REDWOOD__PRERENDERING = '1'

  // This makes code like globalThis.location.pathname work also outside of the
  // router
  globalThis.location = {
    ...globalThis.location,
    pathname: routerPath,
  }
  // Shim fetch in the node.js context
  // This is to avoid using cross-fetch when configuring apollo-client
  // which would cause the client bundle size to increase
  if (!globalThis.fetch) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore-next-line
    globalThis.fetch = fetch
  }
}

export const writeToDist = (outputHtmlPath: string, renderOutput: string) => {
  const dirName = path.dirname(outputHtmlPath)
  const exist = fs.existsSync(dirName)
  if (!exist) {
    fs.mkdirSync(dirName, { recursive: true })
  }

  fs.writeFileSync(outputHtmlPath, renderOutput)
}

// TODO: Move this closer to where it's used
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
 */
export function getPathsFromTypeScriptConfig(
  config: CompilerOptionsForPaths,
  rootDir: string,
) {
  if (!config) {
    return []
  }

  if (!config.compilerOptions?.paths) {
    return []
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

  const aliases: { find: string; replacement: string }[] = []

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

    aliases.push({ find: aliasKey, replacement: aliasValue })
  }

  return aliases
}
