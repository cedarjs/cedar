import { readFileSync } from 'node:fs'
import path from 'node:path'

import { createServer, isRunnableDevEnvironment, mergeConfig } from 'vite'
import type { Plugin, ViteDevServer, RunnableDevEnvironment, UserConfig } from 'vite'

import { getPaths } from '@cedarjs/project-config'
import {
  cedarCellTransform,
  cedarjsResolveCedarStyleImportsPlugin,
  cedarjsJobPathInjectorPlugin,
  cedarSwapApolloProvider,
} from '@cedarjs/vite'

import { cedarAutoImportsPlugin } from './vite-plugin-cedar-auto-import.js'
import { cedarImportDirPlugin } from './vite-plugin-cedar-import-dir.js'

/**
 * A Vite plugin that transforms CommonJS files to ESM so they work with
 * Vite 6's RunnableDevEnvironment / ESModulesEvaluator, which doesn't
 * understand `module.exports` syntax.
 *
 * Uses `cjs-module-lexer` (a Vite transitive dependency) to detect named
 * exports so they are individually re-exported and accessible without going
 * through `.default`.
 */
function cjsCompatPlugin(): Plugin {
  let lexerInitialized = false

  return {
    name: 'cedar-cjs-compat',
    enforce: 'pre',
    async transform(code, id) {
      // Only handle plain .js / .cjs files — TypeScript and JSX are already
      // transformed by Vite's esbuild plugin and will be valid ESM.
      if (!/\.[cm]?js$/.test(id)) {
        return null
      }

      // Quick heuristic: skip files that don't look like CJS
      if (!/\bmodule\.exports\b|\bexports\.\w+/.test(code)) {
        return null
      }

      // Use cjs-module-lexer to statically extract named exports so we can
      // re-export them individually, preserving the import { handler } pattern
      // used by callers like getGqlHandler.
      let namedExports: string[] = []
      try {
        if (!lexerInitialized) {
          const { init } = await import('cjs-module-lexer')
          await init()
          lexerInitialized = true
        }
        const { parse } = await import('cjs-module-lexer')
        const { exports } = parse(code)
        namedExports = exports.filter(
          (e) => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(e) && e !== 'default',
        )
      } catch {
        // If the lexer fails, fall back to default-only export
      }

      const dirPath = JSON.stringify(path.dirname(id))
      const filePath = JSON.stringify(id)

      const namedExportLines = namedExports
        .map((name) => `export const ${name} = __cjs_result__[${JSON.stringify(name)}]`)
        .join('\n')

      return {
        code: `
import { createRequire as __createRequire__ } from 'node:module'
const require = __createRequire__(${filePath})
const module = { exports: {} }
const exports = module.exports
const __dirname = ${dirPath}
const __filename = ${filePath}
;(function() {
${code}
}).call(module.exports)
const __cjs_result__ = module.exports
export default __cjs_result__
${namedExportLines}
`,
        map: null,
      }
    },
  }
}

async function createViteServer(customConfig: UserConfig = {}) {
  const defaultConfig: UserConfig = {
    mode: 'production',
    optimizeDeps: {
      noDiscovery: true,
      include: undefined,
    },
    server: {
      hmr: false,
      watch: null,
    },
    environments: {
      nodeRunnerEnv: {},
    },
    resolve: {
      alias: [
        {
          find: /^src\/(.*?)(\.([jt]sx?))?$/,
          replacement: getPaths().api.src + '/$1',
        },
      ],
    },
    plugins: [
      cjsCompatPlugin(),
      cedarImportDirPlugin(),
      cedarAutoImportsPlugin(),
      cedarjsResolveCedarStyleImportsPlugin(),
      cedarCellTransform(),
      cedarjsJobPathInjectorPlugin(),
      cedarSwapApolloProvider(),
    ],
  }

  const mergedConfig = mergeConfig(defaultConfig, customConfig)

  const server = await createServer(mergedConfig)

  return server
}

export class NodeRunner {
  private viteServer?: ViteDevServer = undefined
  private env?: RunnableDevEnvironment = undefined
  private readonly customViteConfig: UserConfig

  constructor(customViteConfig: UserConfig = {}) {
    this.customViteConfig = customViteConfig
  }

  async init() {
    this.viteServer = await createViteServer(this.customViteConfig)

    const env = this.viteServer.environments.nodeRunnerEnv
    if (!env || !isRunnableDevEnvironment(env)) {
      await this.viteServer.close()
      throw new Error('Vite environment is not runnable.')
    }

    this.env = env
  }

  async importFile(filePath: string) {
    if (!this.env) {
      await this.init()
    }

    const env = this.env
    if (!env) {
      throw new Error('NodeRunner failed to initialize')
    }

    return env.runner.import(filePath)
  }

  async close() {
    await this.viteServer?.close()
  }
}
