import { createServer, version as viteVersion, mergeConfig } from 'vite'
import type { ViteDevServer, UserConfig } from 'vite'
import { ViteNodeRunner } from 'vite-node/client'
import { ViteNodeServer } from 'vite-node/server'
import { installSourcemapsSupport } from 'vite-node/source-map'

import { getPaths } from '@cedarjs/project-config'
import {
  cedarCellTransform,
  cedarjsDirectoryNamedImportPlugin,
  cedarjsJobPathInjectorPlugin,
  cedarSwapApolloProvider,
} from '@cedarjs/vite'

import { autoImportsPlugin } from './vite-plugin-auto-import.js'
import { cedarImportDirPlugin } from './vite-plugin-cedar-import-dir.js'

async function createViteServer(customConfig: UserConfig = {}) {
  const defaultConfig: UserConfig = {
    mode: 'production',
    optimizeDeps: {
      // This is recommended in the vite-node readme
      noDiscovery: true,
      include: undefined,
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
      cedarImportDirPlugin(),
      autoImportsPlugin(),
      cedarjsDirectoryNamedImportPlugin(),
      cedarCellTransform(),
      cedarjsJobPathInjectorPlugin(),
      cedarSwapApolloProvider(),
    ],
  }

  const mergedConfig = mergeConfig(defaultConfig, customConfig)

  const server = await createServer(mergedConfig)

  // For old Vite, this is needed to initialize the plugins.
  if (Number(viteVersion.split('.')[0]) < 6) {
    await server.pluginContainer.buildStart({})
  }

  return server
}

export class NodeRunner {
  private viteServer?: ViteDevServer = undefined
  private runner?: ViteNodeRunner = undefined
  private readonly customViteConfig: UserConfig

  constructor(customViteConfig: UserConfig = {}) {
    this.customViteConfig = customViteConfig
  }

  async init() {
    this.viteServer = await createViteServer(this.customViteConfig)
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
