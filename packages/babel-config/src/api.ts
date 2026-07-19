import fs from 'node:fs'
import path from 'node:path'

import type { PluginOptions, PluginTarget, TransformOptions } from '@babel/core'
import { transformAsync } from '@babel/core'
import { resolvePath } from 'babel-plugin-module-resolver'

import { getPaths, projectSideIsEsm } from '@cedarjs/project-config'

import type { RegisterHookOptions } from './common.js'
import {
  getCommonPlugins,
  getPathsFromTypeScriptConfig,
  parseTypeScriptConfigFiles,
  registerBabel,
} from './common.js'
import handlerAlsWrappingPlugin from './plugins/babel-plugin-handler-als-wrapping.js'
import pluginRedwoodDirectoryNamedImport from './plugins/babel-plugin-redwood-directory-named-import.js'
import pluginRedwoodImportDir from './plugins/babel-plugin-redwood-import-dir.js'
import pluginRedwoodJobPathInjector from './plugins/babel-plugin-redwood-job-path-injector.js'

export const TARGETS_NODE = '24'

export const getApiSideBabelPresets = (
  { presetEnv } = { presetEnv: false },
) => {
  return [
    [
      '@babel/preset-typescript',
      {
        isTSX: true,
        allExtensions: true,
      },
      'rwjs-babel-preset-typescript',
    ],
    // Preset-env is required when we are not doing the transpilation with esbuild
    presetEnv && [
      '@babel/preset-env',
      {
        targets: {
          node: TARGETS_NODE,
        },
        useBuiltIns: false,
      },
    ],
  ].filter(Boolean) as TransformOptions['presets']
}

// Plugin shape: [ ["Target", "Options", "name"] ],
// a custom "name" can be supplied so that user's do not accidentally overwrite
// Redwood's own plugins when they specify their own.
export type PluginList = PluginShape[]
type PluginShape =
  | [PluginTarget, PluginOptions, undefined | string]
  | [PluginTarget, PluginOptions]

export const getApiSideBabelPlugins = ({
  forVite = false,
  projectIsEsm = false,
} = {}) => {
  const tsConfig = parseTypeScriptConfigFiles()

  const plugins: (PluginShape | boolean)[] = [
    ...getCommonPlugins(),
    // Needed to support `/** @jsxImportSource custom-jsx-library */`
    // comments in JSX files
    !forVite && ['@babel/plugin-transform-react-jsx', { runtime: 'automatic' }],
    // Vite/esbuild use applySrcAlias + applyTsconfigPaths (or, for Vite
    // proper, cedar-api-src-redirect + vite-tsconfig-paths) for alias
    // resolution, making this plugin's alias config a no-op there — but it
    // must stay active regardless of forVite, because its resolvePath below
    // also appends `.js`/`.jsx` extensions for every relative import in ESM
    // projects (required for Node's ESM resolver), which nothing else in the
    // Vite/esbuild pipeline replaces.
    [
      'babel-plugin-module-resolver',
      {
        alias: {
          src: './src',
          // adds the paths from [ts|js]config.json to the module resolver
          ...getPathsFromTypeScriptConfig(tsConfig.api, getPaths().api.base),
        },
        root: [getPaths().api.base],
        cwd: 'packagejson',
        loglevel: 'silent', // to silence the unnecessary warnings
        resolvePath: function (
          sourcePath: string,
          currentFile: string,
          opts: unknown,
        ) {
          // To support imports like `import { logger } from './logger.js'` in
          // data-migrate and prerender in TypeScript projects (where the actual
          // source file is logger.ts) we have to rewrite the extension
          const isDataMigrate = process.argv[2] === 'data-migrate'
          const isPrerender = process.argv[2] === 'prerender'
          const importPath =
            /.*\/.*\.js$/.test(sourcePath) && (isDataMigrate || isPrerender)
              ? sourcePath.replace(/\.js$/, '')
              : sourcePath

          const resolvedPath = resolvePath(importPath, currentFile, opts)

          if (!resolvedPath || !projectIsEsm || resolvedPath.includes('/**/')) {
            return resolvedPath
          }

          const currentFileDir = path.dirname(currentFile)
          const joinedPath = path.join(currentFileDir, resolvedPath)

          if (
            fs.existsSync(joinedPath + '.js') ||
            fs.existsSync(joinedPath + '.ts')
          ) {
            return resolvedPath + '.js'
          }

          if (
            fs.existsSync(joinedPath + '.jsx') ||
            fs.existsSync(joinedPath + '.tsx')
          ) {
            return resolvedPath + '.jsx'
          }

          return resolvedPath
        },
      },
      'rwjs-api-module-resolver',
    ],
    [
      pluginRedwoodDirectoryNamedImport,
      undefined,
      'rwjs-babel-directory-named-modules',
    ],
    // Auto-import is handled by cedarAutoImportsPlugin for Vite; skip it in
    // Vite contexts and keep it for non-Vite consumers (Jest, esbuild builds).
    !forVite && [
      'babel-plugin-auto-import',
      {
        declarations: [
          {
            // import gql from 'graphql-tag'
            default: 'gql',
            path: 'graphql-tag',
          },
          {
            // import { context } from '@cedarjs/context'
            members: ['context'],
            path: '@cedarjs/context',
          },
        ],
      },
      'rwjs-babel-auto-import',
    ],
    !forVite && [
      'babel-plugin-graphql-tag',
      undefined,
      'rwjs-babel-graphql-tag',
    ],
    // For Vite builds, glob imports are handled by cedarImportDirPlugin (Vite)
    // or applyImportDir (esbuild).  Keep the Babel plugin only for
    // non-Vite consumers: Jest, console, and data-migrate.
    !forVite && [pluginRedwoodImportDir, {}, 'rwjs-babel-glob-import-dir'],
  ]

  return plugins.filter(<T>(n: T | boolean): n is T => Boolean(n))
}

export const getApiSideBabelConfigPath = () => {
  const p = path.join(getPaths().api.base, 'babel.config.js')
  if (fs.existsSync(p)) {
    return p
  } else {
    return
  }
}

export const getApiSideBabelOverrides = ({
  forVite = false,
  projectIsEsm = false,
  forJest = false,
} = {}) => {
  const overrides = [
    // Apply handler ALS wrapping to all functions (Jest only; Vite uses
    // handlerAlsWrappingPlugin instead)
    forJest && {
      // match */api/src/functions/*.js|ts
      test: /.+api(?:[\\|/])src(?:[\\|/])functions(?:[\\|/]).+.(?:js|ts)$/,
      plugins: [
        [
          handlerAlsWrappingPlugin,
          {
            projectIsEsm,
          },
        ],
      ],
    },
    // Add import names and paths to job definitions. Vite uses
    // cedarjsJobPathInjectorPlugin instead.
    !forVite && {
      // match */api/src/jobs/*.js|ts
      test: /.+api(?:[\\|/])src(?:[\\|/])jobs(?:[\\|/]).+.(?:js|ts)$/,
      plugins: [[pluginRedwoodJobPathInjector]],
    },
  ].filter(Boolean)
  return overrides as TransformOptions[]
}

export const getApiSideDefaultBabelConfig = ({
  forVite = false,
  projectIsEsm = false,
  forJest = false,
} = {}) => {
  return {
    presets: getApiSideBabelPresets(),
    plugins: getApiSideBabelPlugins({ forVite, projectIsEsm }),
    overrides: getApiSideBabelOverrides({ forVite, projectIsEsm, forJest }),
    extends: getApiSideBabelConfigPath(),
    babelrc: false,
    ignore: ['node_modules'],
  }
}

// Used in cli commands that need to use es6, lib and services
export const registerApiSideBabelHook = ({
  plugins = [],
  ...rest
}: RegisterHookOptions = {}) => {
  const defaultOptions = getApiSideDefaultBabelConfig({
    projectIsEsm: projectSideIsEsm('api'),
  })

  registerBabel({
    ...defaultOptions,
    presets: getApiSideBabelPresets({
      presetEnv: true,
    }),
    extensions: ['.js', '.ts', '.jsx', '.tsx'],
    plugins: [...defaultOptions.plugins, ...plugins],
    cache: false,
    ...rest,
  })
}

export const transformWithBabel = async (
  sourceCode: string,
  filename: string,
  plugins: TransformOptions['plugins'],
  sourceMaps: TransformOptions['sourceMaps'] = 'inline',
  forVite = false,
) => {
  const defaultOptions = getApiSideDefaultBabelConfig({
    forVite,
    projectIsEsm: projectSideIsEsm('api'),
  })

  const result = transformAsync(sourceCode, {
    ...defaultOptions,
    cwd: getPaths().api.base,
    filename,
    // The default 'inline' embeds the map as a data URL in result.code,
    // which esbuild consumes when it reads from the result.  Vite callers
    // pass sourceMaps: true because they extract result.map separately for
    // SSR source map chaining.
    sourceMaps,
    plugins,
  })

  return result
}
