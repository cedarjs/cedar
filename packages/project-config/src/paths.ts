import fs from 'node:fs'
import path from 'path'

import fg from 'fast-glob'

import { getConfig } from './config.js'
import { getConfigPath } from './configPath.js'

export interface NodeTargetPaths {
  base: string
  directives: string
  prismaConfig: string
  src: string
  functions: string
  graphql: string
  lib: string
  /** @deprecated - Please use the root `generatorTemplates` directory */
  generators: string
  services: string
  config: string
  dist: string
  types: string
  models: string
  mail: string
  jobs: string
  distJobs: string
  jobsConfig: string | null
  distJobsConfig: string | null
  logger: string | null
}

export interface WebPaths {
  base: string
  src: string
  storybook: string
  app: string
  document: string
  /** @deprecated - Please use the root `generatorTemplates` directory */
  generators: string
  html: string
  routes: string
  pages: string
  components: string
  layouts: string
  config: string
  viteConfig: string
  entryClient: string | null
  entryServer: string | null
  postcss: string
  storybookConfig: string
  storybookPreviewConfig: string | null
  storybookManagerConfig: string
  dist: string
  distBrowser: string
  distRsc: string
  distSsr: string
  distSsrDocument: string
  distSsrEntryServer: string
  distRouteHooks: string
  distRscEntries: string
  routeManifest: string
  types: string
  graphql: string
}

export interface Paths {
  base: string
  generated: {
    base: string
    schema: string
    types: {
      includes: string
      mirror: string
    }
    prebuild: string
  }
  web: WebPaths
  api: NodeTargetPaths
  scripts: string
  generatorTemplates: string
}

export interface PagesDependency {
  /** the variable to which the import is assigned */
  importName: string
  /** @alias importName */
  constName: string
  /** absolute path without extension */
  importPath: string
  /** absolute path with extension */
  path: string
  /** const ${importName} = { ...data structure for async imports... } */
  importStatement: string
}

/**
 * The Redwood config file is used as an anchor for the base directory of a project.
 */
export const getBaseDir = (configPath: string = getConfigPath()): string => {
  return path.dirname(configPath)
}

export const getBaseDirFromFile = (file: string) => {
  return getBaseDir(getConfigPath(path.dirname(file)))
}

/**
 * Use this to resolve files when the path to the file is known,
 * but the extension is not.
 */
export const resolveFile = (
  filePath: string,
  extensions: string[] = ['.js', '.tsx', '.ts', '.jsx', '.mjs', '.mts', '.cjs'],
): string | null => {
  for (const extension of extensions) {
    const p = `${filePath}${extension}`
    if (fs.existsSync(p)) {
      return p
    }
  }
  return null
}

/** Path constants that are relevant to a Cedar project */
const getPathsCache = new Map<string, Paths>()
export const getPaths = (BASE_DIR: string = getBaseDir()): Paths => {
  if (getPathsCache.has(BASE_DIR)) {
    return getPathsCache.get(BASE_DIR) as Paths
  }

  const routes = resolveFile(path.join(BASE_DIR, 'web/src/Routes')) as string
  const { prismaConfig: prismaConfigFromConfig } = getConfig(
    getConfigPath(BASE_DIR),
  ).api
  // Remove extension from config path before resolving to find actual file
  const prismaConfigBase = path.join(
    BASE_DIR,
    prismaConfigFromConfig.replace(/\.[^.]+$/, ''),
  )
  const prismaConfig =
    resolveFile(prismaConfigBase) || path.join(BASE_DIR, prismaConfigFromConfig)

  const viteConfig = resolveFile(
    path.join(BASE_DIR, 'web/vite.config'),
  ) as string

  const paths = {
    base: BASE_DIR,

    generated: {
      base: path.join(BASE_DIR, '.redwood'),
      schema: path.join(BASE_DIR, '.redwood/schema.graphql'),
      types: {
        includes: path.join(BASE_DIR, '.redwood/types/includes'),
        mirror: path.join(BASE_DIR, '.redwood/types/mirror'),
      },
      prebuild: path.join(BASE_DIR, '.redwood/prebuild'),
    },

    scripts: path.join(BASE_DIR, 'scripts'),
    packages: path.join(BASE_DIR, 'packages'),
    generatorTemplates: path.join(BASE_DIR, 'generatorTemplates'),

    api: {
      base: path.join(BASE_DIR, 'api'),
      prismaConfig,
      functions: path.join(BASE_DIR, 'api/src/functions'),
      graphql: path.join(BASE_DIR, 'api/src/graphql'),
      lib: path.join(BASE_DIR, 'api/src/lib'),
      generators: path.join(BASE_DIR, 'api/generators'),
      config: path.join(BASE_DIR, 'api/src/config'),
      services: path.join(BASE_DIR, 'api/src/services'),
      directives: path.join(BASE_DIR, 'api/src/directives'),
      subscriptions: path.join(BASE_DIR, 'api/src/subscriptions'),
      src: path.join(BASE_DIR, 'api/src'),
      dist: path.join(BASE_DIR, 'api/dist'),
      types: path.join(BASE_DIR, 'api/types'),
      models: path.join(BASE_DIR, 'api/src/models'),
      mail: path.join(BASE_DIR, 'api/src', 'mail'),
      jobs: path.join(BASE_DIR, 'api/src/jobs'),
      distJobs: path.join(BASE_DIR, 'api/dist/jobs'),
      jobsConfig: resolveFile(path.join(BASE_DIR, 'api/src/lib', 'jobs')),
      distJobsConfig: resolveFile(
        path.join(BASE_DIR, 'api/dist', 'lib', 'jobs'),
      ),
      logger: resolveFile(path.join(BASE_DIR, 'api/src/lib', 'logger')),
    },

    web: {
      routes,
      base: path.join(BASE_DIR, 'web'),
      pages: path.join(BASE_DIR, 'web/src/pages/'),
      components: path.join(BASE_DIR, 'web/src/components'),
      layouts: path.join(BASE_DIR, 'web/src/layouts/'),
      src: path.join(BASE_DIR, 'web/src'),
      storybook: path.join(BASE_DIR, 'web/.storybook'),
      generators: path.join(BASE_DIR, 'web/generators'),
      app: resolveFile(path.join(BASE_DIR, 'web/src/App')) as string,
      document: resolveFile(path.join(BASE_DIR, 'web/src/Document')) as string,
      html: path.join(BASE_DIR, 'web/src/index.html'),
      config: path.join(BASE_DIR, 'web/config'),
      viteConfig,
      postcss: path.join(BASE_DIR, 'web/config/postcss.config.cjs'),
      storybookConfig: path.join(BASE_DIR, 'web/.storybook/main.js'),
      storybookPreviewConfig: resolveFile(
        path.join(BASE_DIR, 'web/.storybook/preview'),
      ),
      storybookManagerConfig: path.join(BASE_DIR, 'web/.storybook/manager.js'),
      dist: path.join(BASE_DIR, 'web/dist'),
      distBrowser: path.join(BASE_DIR, 'web/dist/browser'),
      distRsc: path.join(BASE_DIR, 'web/dist/rsc'),
      distSsr: path.join(BASE_DIR, 'web/dist/ssr'),
      distSsrDocument: path.join(BASE_DIR, 'web/dist/ssr/Document'),
      distSsrEntryServer: path.join(BASE_DIR, 'web/dist/ssr/entry.server'),
      distRouteHooks: path.join(BASE_DIR, 'web/dist/ssr/routeHooks'),
      distRscEntries: path.join(BASE_DIR, 'web/dist/rsc/entries.mjs'),
      routeManifest: path.join(BASE_DIR, 'web/dist/ssr/route-manifest.json'),
      types: path.join(BASE_DIR, 'web/types'),
      entryClient: resolveFile(path.join(BASE_DIR, 'web/src/entry.client')), // new vite/stream entry point for client
      entryServer: resolveFile(path.join(BASE_DIR, 'web/src/entry.server')),
      graphql: path.join(BASE_DIR, 'web/src/graphql'),
    },
  }

  fs.mkdirSync(paths.generated.types.includes, { recursive: true })
  fs.mkdirSync(paths.generated.types.mirror, { recursive: true })

  getPathsCache.set(BASE_DIR, paths)

  return paths
}

/**
 * Returns the route hook for the supplied page path.
 * Note that the page name doesn't have to match
 *
 * @param pagePath
 * @returns string
 */
export const getRouteHookForPage = (pagePath: string | undefined | null) => {
  if (!pagePath) {
    return null
  }

  // We just use fg, so if they make typos in the routeHook file name,
  // it's all good, we'll still find it
  return (
    fg
      .sync('*.routeHooks.{js,ts,tsx,jsx}', {
        absolute: true,
        cwd: path.dirname(pagePath), // the page's folder
      })
      .at(0) || null
  )
}

/**
 * Use this function to find the app route hook.
 * If it is present, you get the path to the file - in prod, you get the built version in dist.
 * In dev, you get the source version.
 *
 * @param forProd
 * @returns string | null
 */
export const getAppRouteHook = (forProd = false) => {
  const rwPaths = getPaths()

  if (forProd) {
    const distAppRouteHook = path.join(
      rwPaths.web.distRouteHooks,
      'App.routeHooks.js',
    )

    try {
      // Stat sync throws if file doesn't exist
      fs.statSync(distAppRouteHook).isFile()
      return distAppRouteHook
    } catch {
      return null
    }
  }

  return resolveFile(path.join(rwPaths.web.src, 'App.routeHooks'))
}

/**
 * Gets the built server entry file path.
 * Throws an error if the file does not exist.
 */
export function getBuiltServerEntryFile(): string {
  const entryServer = getPaths().web.distSsrEntryServer
  const resolvedEntryServer = resolveFile(entryServer)

  if (!resolvedEntryServer) {
    throw new Error('Server entry file not found (' + entryServer + ')')
  }

  return resolvedEntryServer
}

/**
 * Gets the built Document file path.
 * Throws an error if the file does not exist.
 */
export function getBuiltDocumentFile(): string {
  const document = getPaths().web.distSsrDocument
  const resolvedDocument = resolveFile(document)

  if (!resolvedDocument) {
    throw new Error('Document file not found (' + document + ')')
  }

  return resolvedDocument
}

/**
 * Process the pages directory and return information useful for automated imports.
 *
 * Note: glob.sync returns posix style paths on Windows machines
 * @deprecated I will write a seperate method that use `getFiles` instead. This
 * is used by structure, babel auto-importer and the eslint plugin.
 */
export const processPagesDir = (
  webPagesDir: string = getPaths().web.pages,
): PagesDependency[] => {
  const pagePaths = fg.sync('**/*Page.{js,jsx,ts,tsx}', {
    cwd: webPagesDir,
    ignore: ['node_modules'],
  })
  return pagePaths.map((pagePath) => {
    const p = path.parse(pagePath)

    const importName = p.dir.replace(/\//g, '')
    const importPath = importStatementPath(
      path.join(webPagesDir, p.dir, p.name),
    )

    const importStatement = `const ${importName} = { name: '${importName}', loader: import('${importPath}') }`
    return {
      importName,
      constName: importName,
      importPath,
      path: path.join(webPagesDir, pagePath),
      importStatement,
    }
  })
}

/**
 * Converts Windows-style paths to Posix-style
 * C:\Users\Bob\dev\Redwood -> /c/Users/Bob/dev/Redwood
 *
 * The conversion only happens on Windows systems, and only for paths that are
 * not already Posix-style
 *
 * @param path Filesystem path
 */
export const ensurePosixPath = (path: string) => {
  let posixPath = path

  if (process.platform === 'win32') {
    if (/^[A-Z]:\\/.test(path)) {
      const drive = path[0].toLowerCase()
      posixPath = `/${drive}/${path.substring(3)}`
    }

    posixPath = posixPath.replace(/\\/g, '/')
  }

  return posixPath
}

/**
 * Switches backslash to regular slash on Windows so the path works in
 * import statements
 * C:\Users\Bob\dev\Redwood\UserPage\UserPage ->
 * C:/Users/Bob/dev/Redwood/UserPage/UserPage
 *
 * @param path Filesystem path
 */
export const importStatementPath = (path: string) => {
  let importPath = path

  if (process.platform === 'win32') {
    importPath = importPath.replaceAll('\\', '/')
  }

  return importPath
}

// Small collection of ESM helpers.

function packageJsonIsEsm(packageJsonPath: string) {
  const packageJsonContents = JSON.parse(
    fs.readFileSync(packageJsonPath, 'utf-8'),
  )
  return packageJsonContents.type === 'module'
}

export function projectRootIsEsm() {
  return packageJsonIsEsm(path.join(getPaths().base, 'package.json'))
}

export function projectSideIsEsm(side: 'api' | 'web') {
  const redwoodProjectPaths = getPaths()
  return packageJsonIsEsm(
    path.join(redwoodProjectPaths[side].base, 'package.json'),
  )
}

export function projectIsEsm() {
  if (!projectRootIsEsm()) {
    return false
  }

  for (const side of ['api', 'web'] as const) {
    if (!projectSideIsEsm(side)) {
      return false
    }
  }

  return true
}

export const isTypeScriptProject = () => {
  const paths = getPaths()
  return (
    fs.existsSync(path.join(paths.web.base, 'tsconfig.json')) ||
    fs.existsSync(path.join(paths.api.base, 'tsconfig.json'))
  )
}
