import path from 'node:path'

import { createServer, isRunnableDevEnvironment, mergeConfig } from 'vite'
import type {
  Plugin,
  ViteDevServer,
  RunnableDevEnvironment,
  UserConfig,
} from 'vite'

import { getPaths } from '@cedarjs/project-config'
import {
  cedarCellTransform,
  cedarjsResolveCedarStyleImportsPlugin,
  cedarjsJobPathInjectorPlugin,
  cedarSwapApolloProvider,
} from '@cedarjs/vite'

import { cedarAutoImportsPlugin } from './vite-plugin-cedar-auto-import.js'
import { cedarImportDirPlugin } from './vite-plugin-cedar-import-dir.js'

// Initialize cjs-module-lexer eagerly at module load so it's available before
// any Vite transforms run. buildStart is not guaranteed to fire for all Vite
// environments (e.g. nodeRunnerEnv), so we can't rely on it for initialization.
let lexerParse: ((code: string) => { exports: string[] }) | null = null
const lexerReady: Promise<void> = import('cjs-module-lexer')
  .then(({ init, parse }) =>
    init().then(() => {
      lexerParse = parse
    }),
  )
  .catch(() => {
    // Fall back to extractCjsNamedExports only if cjs-module-lexer is unavailable
  })

/**
 * Extracts named exports from CommonJS code without relying on cjs-module-lexer,
 * which fails to detect exports when values are function expressions or other
 * non-trivial expressions (e.g. `module.exports = { handler: function() {} }`).
 *
 * Handles two CJS export patterns:
 * - `exports.key = value` — regex
 * - `module.exports = { key: value, ... }` — brace-counting to find top-level keys
 */
function extractCjsNamedExports(code: string): string[] {
  const identifierRe = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/
  const namedExports = new Set<string>()

  // Pattern 1: exports.key = value
  const exportsAssignRe = /\bexports\.([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=/g
  for (const match of code.matchAll(exportsAssignRe)) {
    if (match[1] !== 'default') {
      namedExports.add(match[1])
    }
  }

  // Pattern 2: module.exports = { key: value, ... }
  // Brace-counting scan to capture only top-level property keys, correctly
  // skipping over nested objects, function bodies, strings, and comments.
  const assignMatch = code.match(/module\.exports\s*=\s*\{/)
  if (assignMatch?.index !== undefined) {
    const bodyStart = assignMatch.index + assignMatch[0].length
    let depth = 1
    let pos = bodyStart

    while (pos < code.length && depth > 0) {
      const ch = code[pos]

      // Skip strings (single, double, template)
      if (ch === '"' || ch === "'" || ch === '`') {
        const quote = ch
        pos++
        while (pos < code.length && code[pos] !== quote) {
          if (code[pos] === '\\') {
            pos++
          }
          pos++
        }
        pos++
        continue
      }

      // Skip line comments
      if (ch === '/' && code[pos + 1] === '/') {
        while (pos < code.length && code[pos] !== '\n') {
          pos++
        }
        continue
      }

      // Skip block comments
      if (ch === '/' && code[pos + 1] === '*') {
        pos += 2
        while (
          pos < code.length &&
          !(code[pos] === '*' && code[pos + 1] === '/')
        ) {
          pos++
        }
        pos += 2
        continue
      }

      if (ch === '{' || ch === '(' || ch === '[') {
        depth++
        pos++
        continue
      }

      if (ch === '}' || ch === ')' || ch === ']') {
        depth--
        pos++
        continue
      }

      // At depth 1 (top level of the object literal), look for `identifier:` patterns
      if (depth === 1 && /[a-zA-Z_$]/.test(ch)) {
        const keyMatch = code
          .slice(pos)
          .match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/)
        if (
          keyMatch &&
          keyMatch[1] !== 'default' &&
          identifierRe.test(keyMatch[1])
        ) {
          namedExports.add(keyMatch[1])
          pos += keyMatch[0].length
          continue
        }
      }

      pos++
    }
  }

  return [...namedExports]
}

/**
 * A Vite plugin that transforms CommonJS files to ESM so they work with
 * Vite 6's RunnableDevEnvironment / ESModulesEvaluator, which doesn't
 * understand `module.exports` syntax.
 *
 * Uses two complementary strategies for named export detection:
 * 1. `cjs-module-lexer` (initialized at module load via `lexerReady`) — handles
 *    esbuild-compiled packages using the `__export` + `0 && (module.exports = {...})`
 *    annotation pattern.
 * 2. `extractCjsNamedExports` — handles hand-written CJS with function values
 *    that cjs-module-lexer cannot statically detect.
 *
 * The transform hook is intentionally synchronous: Vite 6's non-default
 * environments (e.g. nodeRunnerEnv) do not reliably call async transform hooks
 * or buildStart, so the lexer must be initialized at module load time instead.
 */
function cjsCompatPlugin(): Plugin {
  return {
    name: 'cedar-cjs-compat',
    enforce: 'pre',

    transform(code, id) {
      // Only handle plain .js / .cjs files — TypeScript and JSX are already
      // transformed by Vite's esbuild plugin and will be valid ESM.
      if (!/\.[cm]?js$/.test(id)) {
        return null
      }

      // Quick heuristic: skip files that don't look like CJS
      if (!/\bmodule\.exports\b|\bexports\.\w+/.test(code)) {
        return null
      }

      // Combine both strategies: cjs-module-lexer handles esbuild-compiled
      // packages; extractCjsNamedExports handles hand-written modules with
      // function values that cjs-module-lexer cannot statically detect.
      const namedExports = new Set(extractCjsNamedExports(code))
      if (lexerParse) {
        try {
          const { exports } = lexerParse(code)
          for (const e of exports) {
            if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(e) && e !== 'default') {
              namedExports.add(e)
            }
          }
        } catch {
          // Ignore — extractCjsNamedExports result is still used
        }
      }

      const dirPath = JSON.stringify(path.dirname(id))
      const filePath = JSON.stringify(id)

      const namedExportLines = [...namedExports]
        .map(
          (name) =>
            `export const ${name} = __cjs_result__[${JSON.stringify(name)}]`,
        )
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
  // Ensure cjs-module-lexer is initialized before any file transforms run.
  // We can't rely on buildStart for this because it isn't guaranteed to fire
  // for non-default Vite environments (e.g. nodeRunnerEnv).
  await lexerReady

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
