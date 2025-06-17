import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import commonjs from '@rollup/plugin-commonjs'
import { nodeResolve } from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'
import { loadTsConfig } from 'load-tsconfig'
import { rollup, watch } from 'rollup'
import type {
  RollupOptions,
  RollupBuild,
  RollupWatchOptions,
  Plugin as RollupPlugin,
  OutputOptions,
} from 'rollup'

import { dynamicImport, getRandomId, guessFormat } from './utils'

const DIRNAME_VAR_NAME = '__injected_dirname__'
const FILENAME_VAR_NAME = '__injected_filename__'
const IMPORT_META_URL_VAR_NAME = '__injected_import_meta_url__'

/** Match .mjs, .cts, .ts, .jsx etc */
export const JS_EXT_RE = /\.([mc]?[tj]s|[tj]sx)$/
/** Match /node_modules/ and \node_modules\ (for both *nix and win support) */
const PATH_NODE_MODULES_RE = /[\/\\]node_modules[\/\\]/

export type RequireFunction = (
  outfile: string,
  ctx: { format: 'cjs' | 'esm' },
) => any

export type GetOutputFile = (filepath: string, format: 'esm' | 'cjs') => string

export type RebuildCallback = (
  error: { errors: any[]; warnings: any[] } | null,
  result: { dependencies?: string[] } | null,
) => void

export interface Options {
  cwd?: string

  /** The filepath to bundle and require */
  filepath: string

  /**
   * The `require` function that is used to load the output file
   * Default to the global `require` function
   * This function can be asynchronous, i.e. returns a Promise
   */
  require?: RequireFunction

  /** rollup options */
  rollupOptions?: RollupOptions & {
    /**
     * @deprecated `rollupOptions.watch` is deprecated, use `onRebuild` instead
     */
    watch?:
      | boolean
      | {
          onRebuild?: RebuildCallback
        }
  }

  /**
   * Get the path to the output file
   * By default we simply replace the extension with `.bundled_{randomId}.js`
   */
  getOutputFile?: GetOutputFile

  /**
   * Enable watching and call the callback after each rebuild
   */
  onRebuild?: (ctx: {
    err?: { errors: any[]; warnings: any[] }
    mod?: any
    dependencies?: string[]
  }) => void

  /** External packages */
  external?: (string | RegExp)[]

  /** Not external packages */
  notExternal?: (string | RegExp)[]

  /**
   * Automatically mark node_modules as external
   * @default true - `false` when `filepath` is in node_modules
   */
  externalNodeModules?: boolean

  /**
   * A custom tsconfig path to read `paths` option
   *
   * Set to `false` to disable tsconfig
   * Or provide a `TsconfigRaw` object
   */
  tsconfig?: string | any | false

  /**
   * Preserve compiled temporary file for debugging
   * Default to `process.env.BUNDLE_REQUIRE_PRESERVE`
   */
  preserveTemporaryFile?: boolean

  /** Provide bundle format explicitly to skip the default format inference */
  format?: 'cjs' | 'esm'
}

// Use a random path to avoid import cache
const defaultGetOutputFile: GetOutputFile = (filepath, format) =>
  filepath.replace(
    JS_EXT_RE,
    `.bundled_${getRandomId()}.${format === 'esm' ? 'mjs' : 'cjs'}`,
  )

export const tsconfigPathsToRegExp = (paths: Record<string, any>) => {
  return Object.keys(paths || {}).map((key) => {
    return new RegExp(`^${key.replace(/\*/, '.*')}$`)
  })
}

export const match = (id: string, patterns?: (string | RegExp)[]) => {
  if (!patterns) {
    return false
  }
  return patterns.some((p) => {
    if (p instanceof RegExp) {
      return p.test(id)
    }
    return id === p || id.startsWith(p + '/')
  })
}

/** A rollup plugin to mark node_modules as external */
export const externalPlugin = ({
  external,
  notExternal,
  externalNodeModules = true,
}: {
  external?: (string | RegExp)[]
  notExternal?: (string | RegExp)[]
  externalNodeModules?: boolean
} = {}): RollupPlugin => {
  const builtinModules = new Set([
    'assert',
    'buffer',
    'child_process',
    'cluster',
    'crypto',
    'dgram',
    'dns',
    'domain',
    'events',
    'fs',
    'http',
    'https',
    'net',
    'os',
    'path',
    'punycode',
    'querystring',
    'readline',
    'stream',
    'string_decoder',
    'tls',
    'tty',
    'url',
    'util',
    'v8',
    'vm',
    'zlib',
    'constants',
    'sys',
    'module',
    'process',
    'inspector',
    'async_hooks',
    'http2',
    'perf_hooks',
    'trace_events',
    'worker_threads',
    'repl',
    'timers',
  ])

  return {
    name: 'bundle-require:external',
    resolveId(id, importer) {
      // Handle Node.js built-in modules
      if (builtinModules.has(id) || id.startsWith('node:')) {
        return { id, external: true }
      }

      if (match(id, external)) {
        return { id, external: true }
      }

      if (match(id, notExternal)) {
        // Should be resolved by rollup
        return null
      }

      if (externalNodeModules && id.match(PATH_NODE_MODULES_RE)) {
        const resolved =
          id.startsWith('.') && importer
            ? path.resolve(path.dirname(importer), id)
            : id

        return {
          id: pathToFileURL(resolved).toString(),
          external: true,
        }
      }

      if (id.startsWith('.') || path.isAbsolute(id)) {
        // Let other plugins handle relative/absolute paths
        return null
      }

      // Most likely importing from node_modules, mark external
      return { id, external: true }
    },
  }
}

export const injectFileGlobalsPlugin = (): RollupPlugin => {
  return {
    name: 'bundle-require:inject-file-globals',
    transform(code, id) {
      if (!JS_EXT_RE.test(id)) {
        return null
      }

      // Replace variables with injected versions in the transformed code
      const transformedCode = code
        .replace(/\b__filename\b/g, FILENAME_VAR_NAME)
        .replace(/\b__dirname\b/g, DIRNAME_VAR_NAME)
        .replace(/\bimport\.meta\.url\b/g, IMPORT_META_URL_VAR_NAME)

      const injectLines = [
        `const ${FILENAME_VAR_NAME} = ${JSON.stringify(id)};`,
        `const ${DIRNAME_VAR_NAME} = ${JSON.stringify(path.dirname(id))};`,
        `const ${IMPORT_META_URL_VAR_NAME} = ${JSON.stringify(
          pathToFileURL(id).href,
        )};`,
      ]

      return {
        code: injectLines.join('\n') + '\n' + transformedCode,
        // TODO: Generate a proper source map
        map: { mappings: '' },
      }
    },
  }
}

export function rollupRequire<T = any>(
  options: Options,
): Promise<{
  mod: T
  dependencies: string[]
}> {
  return new Promise((resolve, reject) => {
    if (!JS_EXT_RE.test(options.filepath)) {
      throw new Error(`${options.filepath} is not a valid JS file`)
    }

    const preserveTemporaryFile =
      options.preserveTemporaryFile ?? !!process.env.BUNDLE_REQUIRE_PRESERVE
    const cwd = options.cwd || process.cwd()
    const format = options.format ?? guessFormat(options.filepath)
    const tsconfig =
      options.tsconfig === false
        ? undefined
        : typeof options.tsconfig === 'string' || !options.tsconfig
          ? loadTsConfig(cwd, options.tsconfig)
          : { data: options.tsconfig, path: undefined }

    const resolvePaths = tsconfigPathsToRegExp(
      tsconfig?.data.compilerOptions?.paths || {},
    )

    const extractResult = async (build: RollupBuild) => {
      const getOutputFile = options.getOutputFile || defaultGetOutputFile
      const outfile = getOutputFile(options.filepath, format)

      const outputOptions: OutputOptions = {
        file: outfile,
        format: format === 'esm' ? 'es' : 'cjs',
        exports: 'auto',
        sourcemap: 'inline',
      }

      const { output } = await build.generate(outputOptions)
      const chunk = output[0]

      if (chunk.type !== 'chunk') {
        throw new Error('[bundle-require] Expected chunk output')
      }

      await fs.promises.writeFile(outfile, chunk.code, 'utf8')

      let mod: any

      const req: RequireFunction = options.require || dynamicImport

      try {
        mod = await req(
          format === 'esm' ? pathToFileURL(outfile).href : outfile,
          { format },
        )
      } finally {
        if (!preserveTemporaryFile) {
          // Remove the outfile after executed
          await fs.promises.unlink(outfile)
        }
      }

      const dependencies = Object.keys(chunk.modules || {}).map((dep) =>
        path.relative(cwd, dep),
      )

      return {
        mod,
        dependencies,
      }
    }

    const { watch: watchMode, ...restRollupOptions } =
      options.rollupOptions || {}

    const userPlugins = options.rollupOptions?.plugins
      ? Array.isArray(options.rollupOptions.plugins)
        ? options.rollupOptions.plugins
        : [options.rollupOptions.plugins]
      : []

    const isTypeScriptFile =
      path.extname(options.filepath) === '.ts' ||
      path.extname(options.filepath) === '.tsx'

    const typescriptOptions: Parameters<typeof typescript>[0] = {
      sourceMap: true,
      inlineSourceMap: true,
      declaration: false,
      declarationMap: false,
      noEmit: true,
      skipLibCheck: true,
    }

    if (tsconfig?.path) {
      typescriptOptions.tsconfig = tsconfig.path
    } else if (tsconfig?.data) {
      typescriptOptions.compilerOptions = tsconfig.data.compilerOptions
    }

    console.log('typescriptOptions', typescriptOptions)

    const tsPlugins = isTypeScriptFile ? [typescript(typescriptOptions)] : []

    const basePlugins = [
      externalPlugin({
        external: options.external,
        notExternal: [...(options.notExternal || []), ...resolvePaths],
        // When `filepath` is in node_modules, this is default to false
        externalNodeModules:
          options.externalNodeModules ??
          !options.filepath.match(PATH_NODE_MODULES_RE),
      }),
      nodeResolve({
        preferBuiltins: true,
        exportConditions: ['node'],
        extensions: ['.js', '.ts', '.tsx', '.mjs', '.cjs'],
      }),
      commonjs(),
      ...tsPlugins,
      injectFileGlobalsPlugin(),
    ]

    const inputOptions: RollupOptions = {
      input: options.filepath,
      ...restRollupOptions,
      plugins: [...userPlugins, ...basePlugins],
    }

    const run = async () => {
      if (!(watchMode || options.onRebuild)) {
        const build = await rollup(inputOptions)
        try {
          resolve(await extractResult(build))
        } finally {
          await build.close()
        }
      } else {
        const rebuildCallback: RebuildCallback =
          typeof watchMode === 'object' &&
          typeof watchMode.onRebuild === 'function'
            ? watchMode.onRebuild
            : async (error, result) => {
                if (error) {
                  options.onRebuild?.({ err: error })
                }
                if (result) {
                  options.onRebuild?.(result)
                }
              }

        const watchOptions: RollupWatchOptions = {
          ...inputOptions,
          watch: {
            include: [options.filepath],
            exclude: ['node_modules/**'],
          },
        }

        let isFirst = true

        const handleEvent = async (event: any) => {
          if (event.code === 'BUNDLE_END') {
            try {
              const result = await extractResult(event.result)
              if (isFirst) {
                isFirst = false
                resolve(result)
              } else {
                rebuildCallback(null, result)
              }
            } catch (error: any) {
              if (isFirst) {
                isFirst = false
                reject(error)
              } else {
                rebuildCallback({ errors: [error], warnings: [] }, null)
              }
            } finally {
              if (event.result) {
                await event.result.close()
              }
            }
          } else if (event.code === 'ERROR') {
            const error = { errors: [event.error], warnings: [] }
            if (isFirst) {
              isFirst = false
              reject(event.error)
            } else {
              rebuildCallback(error, null)
            }
          }
        }

        const watcher = watch(watchOptions)
        watcher.on('event', handleEvent)
      }
    }

    run().catch(reject)
  })
}
