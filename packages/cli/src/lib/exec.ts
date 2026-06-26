import { existsSync } from 'node:fs'
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

// When the customResolver returns an id, that id is final — Vite won't try
// alternative extensions on it. This helper resolves the actual file on disk,
// handling both bare paths (src/lib/jobs) and .js/.jsx paths that map to .ts
// files in a TypeScript project (e.g. db.js → db.ts).
function resolveExtension(id: string): string {
  if (existsSync(id)) {
    return id
  }
  // Strip .js/.jsx extension if present, then try TypeScript and JS extensions
  const withoutExt = /\.jsx?$/.test(id) ? id.replace(/\.jsx?$/, '') : id
  for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
    if (existsSync(withoutExt + ext)) {
      return withoutExt + ext
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
      alias: [
        {
          find: /^\$api\//,
          replacement: getPaths().api.base + '/',
        },
        {
          find: /^\$web\//,
          replacement: getPaths().web.base + '/',
        },
        {
          find: /^api\//,
          replacement: getPaths().api.base + '/',
        },
        {
          find: /^web\//,
          replacement: getPaths().web.base + '/',
        },
        {
          find: /^src\//,
          replacement: 'src/',
          customResolver: (id, importer, _options) => {
            const apiImportBase = importStatementPath(getPaths().api.base)
            const webImportBase = importStatementPath(getPaths().web.base)

            // When importing a file from the api directory (using api/src/...
            // in the script), that file in turn might import another file using
            // just src/... That's a problem for Vite when it's running a file
            // from scripts/ because it doesn't know what the src/ alias is.
            // So we have to tell it to use the correct path based on what file
            // is doing the importing.
            // Also, to support imports like 'src/lib/db.js' in TS projects
            // where only a .ts file exists, we resolve the correct extension
            // ourselves — the customResolver result is final and Vite won't
            // try alternative extensions on it.
            if (importer?.startsWith(apiImportBase)) {
              const apiImportSrc = importStatementPath(getPaths().api.src)
              const resolvedId = id.replace('src', apiImportSrc)
              return { id: resolveExtension(resolvedId) }
            } else if (importer?.startsWith(webImportBase)) {
              const webImportSrc = importStatementPath(getPaths().web.src)
              const resolvedId = id.replace('src', webImportSrc)
              return { id: resolveExtension(resolvedId) }
            }

            return null
          },
        },
      ],
    },
    plugins: [
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
