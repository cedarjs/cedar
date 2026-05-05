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
} from '@cedarjs/vite'

export async function runScriptFunction({
  path: scriptPath,
  functionName,
  args,
}) {
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
            // Also, to support both imports like 'src/lib/db.js' and
            // 'src/lib/db' in ts files we need to have special treatment for
            // the .js extension.
            if (importer.startsWith(apiImportBase)) {
              const apiImportSrc = importStatementPath(getPaths().api.src)
              let resolvedId = id.replace('src', apiImportSrc)
              if (importer.endsWith('.ts') || importer.endsWith('.tsx')) {
                resolvedId = resolvedId.replace(/\.jsx?$/, '')
              }
              return { id: resolvedId }
            } else if (importer.startsWith(webImportBase)) {
              const webImportSrc = importStatementPath(getPaths().web.src)
              let resolvedId = id.replace('src', webImportSrc)
              if (importer.endsWith('.ts') || importer.endsWith('.tsx')) {
                resolvedId = resolvedId.replace(/\.jsx?$/, '')
              }
              return { id: resolvedId }
            }

            return null
          },
        },
      ],
    },
    plugins: [
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

  let returnValue
  let scriptError = null

  try {
    const script = await env.runner.import(scriptPath)
    returnValue = await script[functionName](args)
  } catch (error) {
    scriptError = error
  }

  try {
    const { db } = await env.runner.import(
      path.join(getPaths().api.lib, 'db'),
    )
    db.$disconnect()
  } catch (e) {
    // silence
  }

  await server.close()
  process.env.NODE_ENV = NODE_ENV

  if (scriptError) {
    throw scriptError
  }

  return returnValue
}
