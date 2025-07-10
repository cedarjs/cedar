import path from 'node:path'

import { createServer, version as viteVersion } from 'vite'
import { ViteNodeRunner } from 'vite-node/client'
import { ViteNodeServer } from 'vite-node/server'
import { installSourcemapsSupport } from 'vite-node/source-map'

import {
  getConfig,
  getPaths,
  importStatementPath,
} from '@cedarjs/project-config'
import {
  cedarCellTransform,
  cedarjsDirectoryNamedImportPlugin,
  cedarjsJobPathInjectorPlugin,
  swapApolloProvider,
} from '@cedarjs/vite/plugins'

export async function runScriptFunction({
  path: scriptPath,
  functionName,
  args,
}) {
  const rwConfig = getConfig()
  const streamingEnabled = rwConfig?.experimental.streamingSsr.enabled

  // Setting 'production' here mainly to silence some Prisma output they have in
  // dev mode
  const NODE_ENV = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'

  const server = await createServer({
    mode: 'production',
    optimizeDeps: {
      // This is recommended in the vite-node readme
      noDiscovery: true,
      include: undefined,
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
            // lib/exex.js: customResolver id src/lib/jobs
            // lib/exex.js: customResolver importer D:/a/cedar/test-project/api/src/jobs/SampleCronJob/SampleCronJob.ts
            // lib/exex.js: customResolver api.base D:\a\cedar\test-project\api
            // lib/exex.js: customResolver importer starts with api base false
            console.log('lib/exex.js: customResolver id', id)
            console.log('lib/exex.js: customResolver importer', importer)
            console.log(
              'lib/exex.js: customResolver api.base',
              getPaths().api.base,
            )
            console.log(
              'lib/exex.js: customResolver importer starts with api base',
              importer.startsWith(getPaths().api.base),
            )
            console.log(
              'lib/exex.js: customResolver importer starts with apiImportBase',
              importer.startsWith(apiImportBase),
            )
            // When importing a file from the api directory (using api/src/...
            // in the script), that file in turn might import another file using
            // just src/... That's a problem for Vite when it's running a file
            // from scripts/ because it doesn't know what the src/ alias is.
            // So we have to tell it to use the correct path based on what file
            // is doing the importing.
            if (importer.startsWith(apiImportBase)) {
              return { id: id.replace('src', apiImportBase) }
            } else if (importer.startsWith(webImportBase)) {
              return { id: id.replace('src', webImportBase) }
            }

            return null
          },
        },
      ],
    },
    plugins: [
      cedarjsDirectoryNamedImportPlugin(),
      cedarCellTransform(),
      cedarjsJobPathInjectorPlugin(),
      streamingEnabled && swapApolloProvider(),
    ],
  })

  // For old Vite, this is needed to initialize the plugins.
  if (Number(viteVersion.split('.')[0]) < 6) {
    await server.pluginContainer.buildStart({})
  }

  const node = new ViteNodeServer(server, {
    transformMode: {
      ssr: [/.*/],
      web: [/\/web\//],
    },
    deps: {
      fallbackCJS: true,
    },
  })

  // fixes stacktraces in Errors
  installSourcemapsSupport({
    getSourceMap: (source) => node.getSourceMap(source),
  })

  const runner = new ViteNodeRunner({
    root: server.config.root,
    base: server.config.base,
    fetchModule(id) {
      return node.fetchModule(id)
    },
    resolveId(id, importer) {
      return node.resolveId(id, importer)
    },
  })

  let returnValue

  try {
    const script = await runner.executeFile(scriptPath)
    returnValue = script[functionName](args)
  } catch (error) {
    // Log errors, but continue execution
    console.error(error)
  }

  try {
    const { db } = await runner.executeFile(path.join(getPaths().api.lib, 'db'))
    db.$disconnect()
  } catch (e) {
    // silence
  }

  await server.close()
  process.env.NODE_ENV = NODE_ENV

  return returnValue
}
