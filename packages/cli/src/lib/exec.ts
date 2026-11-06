import { existsSync, statSync } from 'node:fs'
import path from 'node:path'

import { createServer, isRunnableDevEnvironment } from 'vite'

import { getPaths, importStatementPath } from '@cedarjs/project-config'
import {
  cedarCellTransform,
  cedarjsResolveCedarStyleImportsPlugin,
  cedarjsJobPathInjectorPlugin,
  cedarSwapApolloProvider,
  cedarImportDirPlugin,
  cedarAutoImportsPlugin,
  cedarCjsCompatPlugin,
} from '@cedarjs/vite'

// When a resolveId hook returns an id, that id is final – Vite won't try
// alternative extensions on it. This helper resolves the actual file on disk,
// handling both bare paths (src/lib/jobs) and .js/.jsx paths that map to .ts
// files in a TypeScript project (e.g. db.js -> db.ts). For bare paths it also
// handles resolving index files and directory-named modules.
export function resolveId(id: string): string {
  if (existsSync(id) && statSync(id).isFile()) {
    return id
  }

  // Strip .js/.jsx extension if present, then try TypeScript and JS extensions
  const withoutExt = /\.jsx?$/.test(id) ? id.replace(/\.jsx?$/, '') : id
  for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
    if (existsSync(withoutExt + ext)) {
      return withoutExt + ext
    }
  }

  // If the path refers to a directory, try resolving index files and
  // directory-named modules (e.g. src/lib/auth -> src/lib/auth/auth.ts,
  // src/events -> src/events/index.ts)
  if (existsSync(id) && statSync(id).isDirectory()) {
    for (const base of ['index', path.basename(id)]) {
      for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
        const candidate = path.join(id, base + ext)

        if (existsSync(candidate)) {
          return candidate
        }
      }
    }
  }

  return id
}

interface RunScriptFunctionArgs {
  path: string
  functionName: string
  args: unknown
}

export async function runScriptFunction({
  path: scriptPath,
  functionName,
  args,
}: RunScriptFunctionArgs): Promise<unknown> {
  // Setting 'production' here mainly to silence some Prisma output they have in
  // dev mode
  const NODE_ENV = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'

  const server = await createServer({
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
      // `$api/` and `api/` imports are handled by
      // cedarjsResolveCedarStyleImportsPlugin below, which also resolves
      // Cedar's directory named modules (`$api/src/services/posts` ->
      // posts/posts.ts) and leaves an actual `api` npm package alone. The web
      // side equivalents have no plugin support, so they stay aliases
      alias: [
        {
          find: /^\$web\//,
          replacement: getPaths().web.base + '/',
        },
        {
          find: /^web\//,
          replacement: getPaths().web.base + '/',
        },
      ],
    },
    plugins: [
      {
        // When importing a file from the api directory (using api/src/... in
        // the script), that file in turn might import another file using just
        // src/... That's a problem for Vite when it's running a file from
        // scripts/ because it doesn't know what src/ refers to. So we resolve
        // it based on what file is doing the importing.
        // Also, to support imports like 'src/lib/db.js' in TS projects where
        // only a .ts file exists, we resolve the correct extension ourselves –
        // the resolveId result is final and Vite won't try alternative
        // extensions on it.
        name: 'cedar-resolve-src-imports',
        enforce: 'pre',
        resolveId(id, importer) {
          if (!id.startsWith('src/')) {
            return null
          }

          const apiImportBase = importStatementPath(getPaths().api.base)
          const webImportBase = importStatementPath(getPaths().web.base)

          if (importer?.startsWith(apiImportBase)) {
            const apiImportSrc = importStatementPath(getPaths().api.src)
            return resolveId(id.replace('src', apiImportSrc))
          } else if (importer?.startsWith(webImportBase)) {
            const webImportSrc = importStatementPath(getPaths().web.src)
            return resolveId(id.replace('src', webImportSrc))
          }

          return null
        },
      },
      cedarCjsCompatPlugin(),
      cedarjsResolveCedarStyleImportsPlugin(),
      cedarCellTransform(),
      cedarjsJobPathInjectorPlugin(),
      cedarSwapApolloProvider(),
      cedarImportDirPlugin(),
      cedarAutoImportsPlugin(),
    ],
  })

  const env = server.environments.nodeRunnerEnv
  if (!env || !isRunnableDevEnvironment(env)) {
    await server.close()
    throw new Error('Vite environment is not runnable.')
  }

  let returnValue: unknown

  try {
    // Dynamic module import boundary — shape is not statically known
    const module = await env.runner.import(scriptPath)
    const fn = module[functionName]
    if (typeof fn !== 'function') {
      throw new Error(`Function '${functionName}' not found in script`)
    }
    returnValue = await fn(args)
  } finally {
    try {
      // Dynamic import boundary — db module shape is determined at runtime
      const dbModule = await env.runner.import(
        path.join(getPaths().api.lib, 'db'),
      )
      dbModule.db?.$disconnect?.()
    } catch {
      // silence
    }

    await server.close()
    process.env.NODE_ENV = NODE_ENV
  }

  return returnValue
}
