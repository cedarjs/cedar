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
          find: /^src\//,
          replacement: getPaths().api.src + '/',
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
