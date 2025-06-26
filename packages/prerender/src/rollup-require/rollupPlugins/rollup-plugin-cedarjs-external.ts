import path from 'node:path'
import { pathToFileURL } from 'node:url'

import type { Plugin as RollupPlugin } from 'rollup'

/** Match /node_modules/ and \node_modules\ (for both *nix and win support) */
const PATH_NODE_MODULES_RE = /[\/\\]node_modules[\/\\]/

/** A rollup plugin to mark node_modules as external */
export const externalPlugin = ({
  external,
  notExternal,
  filepath,
  externalNodeModules = true,
}: {
  filepath: string
  external?: (string | RegExp)[]
  notExternal?: (string | RegExp)[]
  externalNodeModules?: boolean
}): RollupPlugin => {
  const extNodeModules =
    externalNodeModules ?? !filepath.match(PATH_NODE_MODULES_RE)
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

      if (extNodeModules && id.match(PATH_NODE_MODULES_RE)) {
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

function match(id: string, patterns?: (string | RegExp)[]) {
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
