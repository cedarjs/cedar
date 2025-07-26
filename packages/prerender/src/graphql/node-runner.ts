import { createServer, version as viteVersion } from 'vite'
import type { ViteDevServer } from 'vite'
import { ViteNodeRunner } from 'vite-node/client'
import { ViteNodeServer } from 'vite-node/server'
import { installSourcemapsSupport } from 'vite-node/source-map'

import { getPaths, projectIsEsm } from '@cedarjs/project-config'
import {
  cedarCellTransform,
  cedarjsDirectoryNamedImportPlugin,
  cedarjsJobPathInjectorPlugin,
  cedarSwapApolloProvider,
} from '@cedarjs/vite'

import { autoImportsPlugin } from './vite-plugin-auto-import.js'
import { cedarImportDirPlugin } from './vite-plugin-cedar-import-dir.js'

async function createViteServer() {
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
          replacement: getPaths().api.src + '/',
          // customResolver: (id, importer, _options) => {
          //   const apiImportBase = importStatementPath(getPaths().api.base)
          //   const webImportBase = importStatementPath(getPaths().web.base)

          //   let resolved: { id: string } | null = null

          //   // When importing a file from the api directory (using api/src/...
          //   // in the script), that file in turn might import another file using
          //   // just src/... That's a problem for Vite when it's running a file
          //   // from scripts/ because it doesn't know what the src/ alias is.
          //   // So we have to tell it to use the correct path based on what file
          //   // is doing the importing.
          //   if (importer?.startsWith(apiImportBase)) {
          //     const apiImportSrc = importStatementPath(getPaths().api.src)
          //     resolved = { id: id.replace('src', apiImportSrc) }
          //   } else if (importer?.startsWith(webImportBase)) {
          //     const webImportSrc = importStatementPath(getPaths().web.src)
          //     resolved = { id: id.replace('src', webImportSrc) }
          //   }

          //   return resolved
          // },
        },
      ],
    },
    plugins: [
      cedarImportDirPlugin({ projectIsEsm: projectIsEsm() }),
      autoImportsPlugin(),
      cedarjsDirectoryNamedImportPlugin(),
      cedarCellTransform(),
      cedarjsJobPathInjectorPlugin(),
      cedarSwapApolloProvider(),
    ],
  })

  // For old Vite, this is needed to initialize the plugins.
  if (Number(viteVersion.split('.')[0]) < 6) {
    await server.pluginContainer.buildStart({})
  }

  return server
}

export class NodeRunner {
  private viteServer?: ViteDevServer = undefined
  private runner?: ViteNodeRunner = undefined

  async init() {
    this.viteServer = await createViteServer()
    const nodeServer = new ViteNodeServer(this.viteServer, {
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
      getSourceMap: (source) => nodeServer?.getSourceMap(source),
    })

    this.runner = new ViteNodeRunner({
      root: this.viteServer.config.root,
      base: this.viteServer.config.base,
      fetchModule(id) {
        return nodeServer.fetchModule(id)
      },
      resolveId(id, importer) {
        return nodeServer.resolveId(id, importer)
      },
    })
  }

  async importFile(filePath: string) {
    if (!this.runner) {
      await this.init()
    }

    return this.runner?.executeFile(filePath)
  }

  async close() {
    await this.viteServer?.close()
  }
}
