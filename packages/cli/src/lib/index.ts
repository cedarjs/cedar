import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'

import * as babel from '@babel/core'
import boxen from 'boxen'
import camelcase from 'camelcase'
import { paramCase } from 'change-case'
import decamelize from 'decamelize'
import execa from 'execa'
import { Listr } from 'listr2'
import type { ListrTaskWrapper } from 'listr2'
import memoize from 'lodash/memoize.js'
import template from 'lodash/template.js'
import pascalcase from 'pascalcase'
import { format } from 'prettier'
import type { Options as PrettierOptions } from 'prettier'

import { colors as c } from '@cedarjs/cli-helpers'
import {
  getConfig as getRedwoodConfig,
  getPaths as getRedwoodPaths,
  resolveFile as internalResolveFile,
  findUp,
} from '@cedarjs/project-config'
import { pluralize, singularize } from '@cedarjs/utils/cedarPluralize'

import { addFileToRollback } from './rollback.js'

export { findUp }

/**
 * Returns variants of the passed `name` for usage in templates. If the given
 * name was "fooBar" then these would be:
 *
 * pascalName: FooBar
 * singularPascalName: FooBar
 * pluralPascalName: FooBars
 * singularCamelName: fooBar
 * pluralCamelName: fooBars
 * singularParamName: foo-bar
 * pluralParamName: foo-bars
 * singularConstantName: FOO_BAR
 * pluralConstantName: FOO_BARS
 */
export const nameVariants = (name: string) => {
  const normalizedName = pascalcase(paramCase(singularize(name)))

  return {
    pascalName: pascalcase(paramCase(name)),
    camelName: camelcase(name),
    singularPascalName: normalizedName,
    pluralPascalName: pluralize(normalizedName),
    singularCamelName: camelcase(normalizedName),
    pluralCamelName: camelcase(pluralize(normalizedName)),
    singularParamName: paramCase(normalizedName),
    pluralParamName: paramCase(pluralize(normalizedName)),
    singularConstantName: decamelize(normalizedName).toUpperCase(),
    pluralConstantName: decamelize(pluralize(normalizedName)).toUpperCase(),
  }
}

export const generateTemplate = <T extends Record<string, unknown>>(
  templateFilename: string,
  { name, ...rest }: { name: string } & T,
) => {
  try {
    const templateFn = template(readFile(templateFilename).toString())
    const renderedTemplate = templateFn({
      name,
      ...nameVariants(name),
      ...rest,
    })

    return prettify(templateFilename, renderedTemplate)
  } catch (error) {
    const originalMessage =
      error instanceof Error ? error.message : String(error)
    const wrappedError = new Error(
      `Error applying template at ${templateFilename} for ${name}: ${originalMessage}`,
    )
    throw wrappedError
  }
}

export const prettify = async (
  templateFilename: string,
  renderedTemplate: string,
) => {
  // We format .js and .css templates, we need to tell prettier which parser
  // we're using.
  // https://prettier.io/docs/en/options.html#parser
  const parserMap: Record<string, 'css' | 'babel' | 'babel-ts'> = {
    '.css': 'css',
    '.js': 'babel',
    '.jsx': 'babel',
    '.ts': 'babel-ts',
    '.tsx': 'babel-ts',
  }
  const parser =
    parserMap[path.extname(templateFilename.replace('.template', ''))]

  if (typeof parser === 'undefined') {
    return renderedTemplate
  }

  const prettierOptions = await getPrettierOptions()

  return format(renderedTemplate, {
    ...prettierOptions,
    parser,
  })
}

export const readFile = (target: string): string =>
  fs.readFileSync(target, { encoding: 'utf8' })

const SUPPORTED_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx']

export const deleteFile = (file: string) => {
  const extension = path.extname(file)
  if (SUPPORTED_EXTENSIONS.includes(extension)) {
    const baseFile = getBaseFile(file)
    SUPPORTED_EXTENSIONS.forEach((ext) => {
      const f = baseFile + ext
      if (fs.existsSync(f)) {
        fs.unlinkSync(f)
      }
    })
  } else {
    fs.unlinkSync(file)
  }
}

const getBaseFile = (file: string) => file.replace(/\.\w*$/, '')

export const existsAnyExtensionSync = (file: string): boolean => {
  const extension = path.extname(file)
  if (SUPPORTED_EXTENSIONS.includes(extension)) {
    const baseFile = getBaseFile(file)
    return SUPPORTED_EXTENSIONS.some((ext) => fs.existsSync(baseFile + ext))
  }

  return fs.existsSync(file)
}

interface WriteFileOptions {
  overwriteExisting?: boolean
}

interface ListrTask {
  title?: string
}

export const writeFile = (
  target: string,
  contents: string,
  { overwriteExisting = false }: WriteFileOptions = {},
  task: ListrTask = {},
) => {
  const { base } = getPaths()
  task.title = `Writing \`./${path.relative(base, target)}\``
  if (!overwriteExisting && fs.existsSync(target)) {
    throw new Error(`${target} already exists.`)
  }

  addFileToRollback(target)

  const filename = path.basename(target)
  const targetDir = target.replace(filename, '')
  fs.mkdirSync(targetDir, { recursive: true })
  fs.writeFileSync(target, contents)
  task.title = `Successfully wrote file \`./${path.relative(base, target)}\``
}

export const saveRemoteFileToDisk = (
  url: string,
  localPath: string,
  { overwriteExisting = false }: WriteFileOptions = {},
) => {
  if (!overwriteExisting && fs.existsSync(localPath)) {
    throw new Error(`${localPath} already exists.`)
  }

  const downloadPromise = new Promise<void>((resolve, reject) =>
    https.get(url, (response) => {
      if (response.statusCode === 200) {
        response.pipe(fs.createWriteStream(localPath))
        resolve()
      } else {
        reject(
          new Error(`${url} responded with status code ${response.statusCode}`),
        )
      }
    }),
  )

  return downloadPromise
}

export async function getInstalledCedarVersion(): Promise<string> {
  try {
    const packageJson = await import('../../package.json', {
      with: { type: 'json' },
    })
    return packageJson.default.version
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error(c.error('Could not find installed Cedar version'))
    console.error(c.error(message))
    process.exit(1)
  }
}

export const bytes = (contents: string): number =>
  Buffer.byteLength(contents, 'utf8')

/**
 * This wraps the core version of getPaths into something that catches the exception
 * and displays a helpful error message.
 */
export const _getPaths = () => {
  try {
    return getRedwoodPaths()
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error(c.error(message))
    process.exit(1)
  }
}
export const getPaths = memoize(_getPaths)
export const resolveFile = internalResolveFile

export const getGraphqlPath = () => {
  const functionsDir = getPaths().api.functions
  if (!functionsDir) {
    throw new Error('Could not resolve the API functions directory')
  }
  return resolveFile(path.join(functionsDir, 'graphql'))
}

export const graphFunctionDoesExist = (): boolean => {
  const graphqlPath = getGraphqlPath()
  if (!graphqlPath) {
    return false
  }
  return fs.existsSync(graphqlPath)
}

export const getConfig = () => {
  try {
    return getRedwoodConfig()
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error(c.error(message))
    process.exit(1)
  }
}

/**
 * This returns the config present in `prettier.config.cjs` or
 * `prettier.config.mjs` of a Cedar project.
 */
export const getPrettierOptions = async (): Promise<
  PrettierOptions | undefined
> => {
  try {
    const cjsPath = path.join(getPaths().base, 'prettier.config.cjs')
    const mjsPath = path.join(getPaths().base, 'prettier.config.mjs')
    const prettierConfigPath = fs.existsSync(cjsPath) ? cjsPath : mjsPath

    const { default: prettierOptions } = await import(
      `file://${prettierConfigPath}`
    )

    return prettierOptions
  } catch {
    // If we're in our vitest environment we want to return a consistent set of prettier options
    // such that snapshots don't change unexpectedly.
    if (process.env.VITEST_POOL_ID !== undefined) {
      return {
        trailingComma: 'es5',
        bracketSpacing: true,
        tabWidth: 2,
        semi: false,
        singleQuote: true,
        arrowParens: 'always',
        overrides: [
          {
            files: 'Routes.*',
            options: {
              printWidth: 999,
            },
          },
        ],
      }
    }
    return undefined
  }
}

// TODO: Move this into `generateTemplate` when all templates have TS support
/*
 * Convert a generated TS template file into JS.
 */
export const transformTSToJS = async (
  filename: string,
  content: string,
): Promise<string> => {
  const result = babel.transform(content, {
    filename,
    // If you ran `yarn cedar generate` in `./web` transformSync would import the `.babelrc.js` file,
    // in `./web`? despite us setting `configFile: false`.
    cwd: process.env.NODE_ENV === 'test' ? undefined : getPaths().base,
    configFile: false,
    plugins: [
      [
        '@babel/plugin-transform-typescript',
        {
          isTSX: true,
          allExtensions: true,
        },
      ],
    ],
    retainLines: true,
  })

  if (result?.code == null) {
    throw new Error(
      `Could not transform ${filename} from TypeScript to JavaScript`,
    )
  }
  return prettify(filename.replace(/\.ts(x)?$/, '.js$1'), result.code)
}

/**
 * Reduces a list of [outputPath, content] tuples to a `Record<outputPath,
 * content>` map, converting each entry's content from TypeScript to JavaScript
 * when `typescript` is false.
 *
 * Returns
 * {
 *    "path/to/fileA": "<<<template>>>",
 *    "path/to/fileB": "<<<template>>>",
 * }
 *
 * @param files - Array of [outputPath, content] tuples
 * @param typescript - If true, content is kept as TypeScript; otherwise it's
 * converted to JS
 */
export const transformTSToJSMap = async (
  files: [string, string][],
  typescript: boolean,
): Promise<Record<string, string>> => {
  return files.reduce(
    async (accP: Promise<Record<string, string>>, [outputPath, content]) => {
      const acc = await accP

      const template = typescript
        ? content
        : await transformTSToJS(outputPath, content)

      return {
        [outputPath]: template,
        ...acc,
      }
    },
    Promise.resolve({}),
  )
}

/**
 * Creates a list of tasks that write files to the disk.
 *
 * @param files - {[filepath]: contents}
 */
export const writeFilesTask = (
  files: Record<string, string>,
  options: WriteFileOptions = {},
) => {
  const { base } = getPaths()
  return new Listr(
    Object.keys(files).map((file) => {
      const contents = files[file]
      return {
        title: `...waiting to write file \`./${path.relative(base, file)}\`...`,
        task: (_ctx: unknown, task: ListrTaskWrapper<unknown, never, never>) =>
          writeFile(file, contents, options, task),
      }
    }),
  )
}

/**
 * Creates a list of tasks that delete files from the disk.
 *
 * @param files - {[filepath]: contents}
 */
export const deleteFilesTask = (files: Record<string, string>) => {
  const { base } = getPaths()

  return new Listr([
    ...Object.keys(files).map((file) => {
      return {
        title: `Destroying \`./${path.relative(base, getBaseFile(file))}\`...`,
        skip: () => !existsAnyExtensionSync(file) && `File doesn't exist`,
        task: () => deleteFile(file),
      }
    }),
    {
      title: 'Cleaning up empty directories...',
      task: () => cleanupEmptyDirsTask(files),
    },
  ])
}

/**
 * @param files - {[filepath]: contents}
 * Deletes any empty directories that are more than three levels deep below the base directory
 * i.e. any directory below /web/src/components
 */
export const cleanupEmptyDirsTask = (files: Record<string, string>) => {
  const { base } = getPaths()
  const endDirs = Object.keys(files).map((file) => path.dirname(file))
  const uniqueEndDirs = [...new Set(endDirs)]
  // get the additional path directories not at the end of the path
  const pathDirs: string[] = []
  uniqueEndDirs.forEach((dir) => {
    const relDir = path.relative(base, dir)
    const splitDir = relDir.split(path.sep)
    splitDir.pop()
    while (splitDir.length > 3) {
      const subDir = path.join(base, splitDir.join('/'))
      pathDirs.push(subDir)
      splitDir.pop()
    }
  })
  const uniqueDirs = uniqueEndDirs.concat([...new Set(pathDirs)])

  return new Listr(
    uniqueDirs.map((dir) => {
      return {
        title: `Removing empty \`./${path.relative(base, dir)}\`...`,
        task: () => fs.rmdirSync(dir),
        skip: () => {
          if (!fs.existsSync(dir)) {
            return `Doesn't exist`
          }
          if (fs.readdirSync(dir).length > 0) {
            return 'Not empty'
          }
          return false
        },
      }
    }),
  )
}

const wrapWithSet = (
  routesContent: string,
  layout: string,
  routes: string[],
  newLineAndIndent: string,
  props: Record<string, string> = {},
) => {
  const match = routesContent.match(/([ \t]*)<Router.*?>[^<]*[\r\n]+([ \t]+)/)
  const indentOne = match?.[1] ?? ''
  const indentTwo = match?.[2] ?? '  '
  const oneLevelIndent = indentTwo.slice(0, indentTwo.length - indentOne.length)
  const newRoutesWithExtraIndent = routes.map((route) => oneLevelIndent + route)

  // converts { foo: 'bar' } to `foo="bar"`
  const propsString = Object.entries(props)
    .map((values) => `${values[0]}="${values[1]}"`)
    .join(' ')

  return [
    `<Set wrap={${layout}}${propsString && ' ' + propsString}>`,
    ...newRoutesWithExtraIndent,
    `</Set>`,
  ].join(newLineAndIndent)
}

/**
 * Update the project's routes file.
 */
export const addRoutesToRouterTask = (
  routes: string[],
  layout?: string,
  setProps: Record<string, string> = {},
) => {
  const cedarPaths = getPaths()
  const routesContent = readFile(cedarPaths.web.routes).toString()
  let newRoutes = routes.filter((route) => !routesContent.match(route))

  if (newRoutes.length) {
    const routerMatch = routesContent.match(/\s*<Router(.*?)>(\s*)/s)
    const routerStart = routerMatch?.[0] ?? ''
    const routerParams = routerMatch?.[1] ?? ''
    const newLineAndIndent = routerMatch?.[2] ?? '\n  '

    if (/trailingSlashes={?(["'])always\1}?/.test(routerParams)) {
      // newRoutes will be something like:
      // ['<Route path="/foo" page={FooPage} name="foo"/>']
      // and we need to replace `path="/foo"` with `path="/foo/"`
      newRoutes = newRoutes.map((route) => {
        if (route.length > 2000) {
          throw new Error(`Route is too long to process:\n${route}`)
        }
        return route.replace(/ path="(.+?)" /, ' path="$1/" ')
      })
    }

    const routesBatch = layout
      ? wrapWithSet(
          routesContent,
          layout,
          newRoutes,
          newLineAndIndent,
          setProps,
        )
      : newRoutes.join(newLineAndIndent)

    const newRoutesContent = routesContent.replace(
      routerStart,
      `${routerStart + routesBatch + newLineAndIndent}`,
    )

    writeFile(cedarPaths.web.routes, newRoutesContent, {
      overwriteExisting: true,
    })
  }
}

export const addScaffoldImport = () => {
  const appJsPath = getPaths().web.app
  let appJsContents = readFile(appJsPath).toString()

  if (appJsContents.match('./scaffold.css')) {
    return 'Skipping scaffold style include'
  }

  appJsContents = appJsContents.replace(
    /import ['"]\.\/index\.css['"]/,
    "import './index.css'\nimport './scaffold.css'\n",
  )
  writeFile(appJsPath, appJsContents, { overwriteExisting: true })

  return 'Added scaffold import to App.{jsx,tsx}'
}

const removeEmtpySet = (routesContent: string, layout: string) => {
  const setWithLayoutReg = new RegExp(
    `\\s*<Set[^>]*wrap={${layout}}[^<]*>([^<]*)<\/Set>`,
  )
  const match = routesContent.match(setWithLayoutReg)
  const matchedSet = match?.[0] ?? ''
  const childContent = match?.[1] ?? ''
  if (!matchedSet) {
    return routesContent
  }

  const child = childContent.replace(/\s/g, '')

  if (child.length > 0) {
    return routesContent
  }
  return routesContent.replace(setWithLayoutReg, '')
}

/**
 * Remove named routes from the project's routes file.
 *
 * @param {string[]} routes - Route names
 */
export const removeRoutesFromRouterTask = (
  routes: string[],
  layout?: string,
) => {
  const cedarPaths = getPaths()
  const routesContent = readFile(cedarPaths.web.routes).toString()
  const newRoutesContent = routes.reduce((content, route) => {
    const matchRouteByName = new RegExp(`\\s*<Route[^>]*name="${route}"[^>]*/>`)
    return content.replace(matchRouteByName, '')
  }, routesContent)

  const routesWithoutEmptySet = layout
    ? removeEmtpySet(newRoutesContent, layout)
    : newRoutesContent

  writeFile(cedarPaths.web.routes, routesWithoutEmptySet, {
    overwriteExisting: true,
  })
}

/**
 *
 * Use this util to install dependencies on a user's Cedar app
 *
 * @example await addPackagesTask({
 * packages: ['tailwindcss', 'somePackage@2.1.0'],
 * side: 'api', // <-- leave empty for project root
 * devDependency: true
 * })
 */
export const addPackagesTask = async ({
  packages,
  side = 'project',
  devDependency = false,
}: {
  packages: string[]
  side?: 'project' | 'web' | 'api'
  devDependency?: boolean
}) => {
  const cedarVersion = await getInstalledCedarVersion()

  const packagesWithSameRWVersion = packages.map((pkg) => {
    if (pkg.includes('@cedarjs')) {
      return `${pkg}@${cedarVersion}`
    } else {
      return pkg
    }
  })

  let installCommand: [string, string[]]
  // if web,api
  if (side !== 'project') {
    installCommand = [
      'yarn',
      [
        'workspace',
        side,
        'add',
        devDependency && '--dev',
        ...packagesWithSameRWVersion,
      ].filter((s): s is string => Boolean(s)),
    ]
  } else {
    installCommand = [
      'yarn',
      ['add', devDependency && '--dev', ...packagesWithSameRWVersion].filter(
        (s): s is string => Boolean(s),
      ),
    ]
  }

  return {
    title: `Adding dependencies to ${side}`,
    task: async () => {
      await execa(...installCommand)
    },
  }
}

// TODO: Move this to generatePrismaClient.js. Possibly just inlining it
// instead of creating a new Listr for generating the client
export const runCommandTask = async (
  commands: {
    title: string
    cmd: string
    args?: string[]
    opts?: execa.Options
    cwd?: string
  }[],
  { verbose, silent }: { verbose?: boolean; silent?: boolean } = {},
) => {
  const tasks = new Listr(
    commands.map(
      ({ title, cmd, args = [], opts = {}, cwd = getPaths().base }) => ({
        title,
        task: async () => {
          return execa(cmd, args, {
            cwd,
            stdio: verbose && !silent ? 'inherit' : 'pipe',
            extendEnv: true,
            cleanup: true,
            ...opts,
          })
        },
      }),
    ),
    {
      renderer: silent ? 'silent' : verbose ? 'verbose' : 'default',
      rendererOptions: { collapseSubtasks: false },
    },
  )

  try {
    await tasks.run()
    return true
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.log(c.error(message))
    return false
  }
}

/** Extract default CLI args from an exported builder */
export const getDefaultArgs = (
  builder: Record<string, { default?: unknown }>,
) => {
  return Object.entries(builder).reduce<Record<string, unknown>>(
    (options, [optionName, optionConfig]) => {
      // If a default is defined use it
      options[optionName] = optionConfig.default
      return options
    },
    {},
  )
}

/**
 * Check if user is using VS Code
 *
 * i.e. check for the existence of .vscode folder in root project directory
 */
export const usingVSCode = (): boolean => {
  const cedarPaths = getPaths()
  const VS_CODE_PATH = path.join(cedarPaths.base, '.vscode')
  return fs.existsSync(VS_CODE_PATH)
}

export const printSetupNotes = (notes: string[]) => {
  return {
    title: 'One more thing...',
    task: (_ctx: unknown, task: ListrTaskWrapper<unknown, never, never>) => {
      task.title = `One more thing...\n\n ${boxen(notes.join('\n'), {
        padding: { top: 1, bottom: 1, right: 1, left: 1 },
        margin: 1,
        borderColor: 'gray',
      })}  \n`
    },
  }
}
