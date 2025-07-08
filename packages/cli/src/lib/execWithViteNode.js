import path from 'node:path'

import { createServer, version as viteVersion } from 'vite'
import { ViteNodeRunner } from 'vite-node/client'
import { ViteNodeServer } from 'vite-node/server'
import { installSourcemapsSupport } from 'vite-node/source-map'

import { getConfig, getPaths } from '@cedarjs/project-config'
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
  const streamingEnabled = rwConfig.experimental.streamingSsr.enabled

  const server = await createServer({
    optimizeDeps: {
      // This is recommended in the vite-node readme
      noDiscovery: true,
      include: undefined,
    },
    resolve: {
      alias: [
        {
          find: /^src\//,
          replacement: 'src/',
          customResolver: (id, importer, _options) => {
            // When importing a file from the api directory (using api/src/...
            // in the script), that file in turn might import another file using
            // just src/... That's a problem for Vite when it's running a file
            // from scripts/ because it doesn't know what the src/ alias is.
            // So we have to tell it to use the correct path based on what file
            // is doing the importing.
            if (importer.startsWith(getPaths().api.base)) {
              return { id: id.replace('src', getPaths().api.src) }
            } else if (importer.startsWith(getPaths().web.base)) {
              return { id: id.replace('src', getPaths().web.src) }
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

  const script = await runner.executeFile(scriptPath)
  const returnValue = script[functionName](args)

  try {
    const { db } = await runner.executeFile(path.join(getPaths().api.lib, 'db'))
    db.$disconnect()
  } catch (e) {
    // silence
    console.log(e)
  }

  await server.close()

  return returnValue
}
