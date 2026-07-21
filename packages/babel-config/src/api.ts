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
  if (forVite) {
    return getApiSideBabelPluginsForVite()
  }

  const tsConfig = parseTypeScriptConfigFiles()

  const plugins: PluginList = [
    ...getCommonPlugins(),
    // Needed to support `/** @jsxImportSource custom-jsx-library */`
    // comments in JSX files
    ['@babel/plugin-transform-react-jsx', { runtime: 'automatic' }],
    // For the non-Vite consumers this function serves (Jest,
    // registerApiSideBabelHook / Babel registerRequire paths such as
    // data-migrate CJS and prerender CJS):
    //   • alias config: rewrites `src/` and tsconfig paths to relative paths
    //   • resolvePath: appends `.js`/`.jsx` to extensionless imports in ESM
    //     projects so Node's module resolver can find them, and strips `.js`
    //     suffixes in data-migrate / prerender contexts where the TypeScript
    //     source is `.ts` but callers write `.js` import specifiers.
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
    // Vite/esbuild use cedarDirectoryNamedImportPlugin / applyDirectoryNamedImport
    // instead of this babel plugin
    [
      pluginRedwoodDirectoryNamedImport,
      undefined,
      'rwjs-babel-directory-named-modules',
    ],
    // Auto-import is handled by cedarAutoImportsPlugin / applyAutoImports for
    // Vite/esbuild; this Babel plugin serves the remaining non-Vite consumers
    // (Jest, registerApiSideBabelHook).
    [
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
    ['babel-plugin-graphql-tag', undefined, 'rwjs-babel-graphql-tag'],
    // For Vite builds, glob imports are handled by cedarImportDirPlugin (Vite)
    // or applyImportDir (esbuild).  Keep the Babel plugin only for
    // non-Vite consumers: Jest, console, and data-migrate.
    [pluginRedwoodImportDir, {}, 'rwjs-babel-glob-import-dir'],
  ]

  return plugins
}

/**
 * Purpose-built equivalent of `getApiSideBabelPlugins({ forVite: true })` for
 * the Vite-driven api pipelines (buildCedarApp, the api dev middleware, and
 * the esbuild/standalone-Vite api builds in @cedarjs/internal).
 *
 * Every Cedar-specific Babel plugin is gated behind `!forVite` in
 * `getApiSideBabelPlugins` because these pipelines replace them with
 * dedicated Vite/esbuild transforms:
 *  - JSX/TypeScript compilation: handled natively by Vite/esbuild
 *  - babel-plugin-module-resolver (`src/` and tsconfig `paths` aliases):
 *    cedar-api-src-redirect + vite-tsconfig-paths (Vite) or applySrcAlias +
 *    applyTsconfigPaths (esbuild); ESM extension rewriting is covered by
 *    applyEsmExtensions
 *  - directory-named imports: cedarDirectoryNamedImportPlugin /
 *    applyDirectoryNamedImport
 *  - auto-imports (gql, context): cedarAutoImportsPlugin / applyAutoImports
 *  - graphql-tag: vite-plugin-graphql-tag
 *  - glob imports: cedarImportDirPlugin / applyImportDir
 *
 * Only the common plugins remain — and that list is currently empty, which
 * is why the Vite pipelines skip Babel entirely unless the project has a
 * custom api/babel.config.js.
 *
 * The `projectIsEsm` option needs no equivalent here: it only affects the
 * module-resolver `resolvePath` hook, which is a `!forVite` plugin.
 */
export const getApiSideBabelPluginsForVite = (): PluginList => {
  return [...getCommonPlugins()]
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

/**
 * The default api-side Babel config for Jest (@cedarjs/testing) and the
 * Babel ESLint parser (@cedarjs/eslint-config). The Jest-only handler ALS
 * wrapping override is always included: it only matches api/src/functions
 * files, and for the parse-only ESLint consumer transform plugins have no
 * effect.
 */
export const getApiSideDefaultBabelConfig = () => {
  return {
    presets: getApiSideBabelPresets(),
    plugins: getApiSideBabelPlugins(),
    overrides: getApiSideBabelOverrides({ forJest: true }),
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
  const projectIsEsm = projectSideIsEsm('api')

  registerBabel({
    presets: getApiSideBabelPresets({
      presetEnv: true,
    }),
    overrides: getApiSideBabelOverrides({ projectIsEsm }),
    extends: getApiSideBabelConfigPath(),
    babelrc: false,
    ignore: ['node_modules'],
    extensions: ['.js', '.ts', '.jsx', '.tsx'],
    plugins: [...getApiSideBabelPlugins({ projectIsEsm }), ...plugins],
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
  const result = transformAsync(sourceCode, {
    presets: getApiSideBabelPresets(),
    overrides: getApiSideBabelOverrides({
      forVite,
      projectIsEsm: projectSideIsEsm('api'),
    }),
    extends: getApiSideBabelConfigPath(),
    babelrc: false,
    ignore: ['node_modules'],
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
