import { createServer, isRunnableDevEnvironment, mergeConfig } from 'vite'
import type { ViteDevServer, RunnableDevEnvironment, UserConfig } from 'vite'

import { getPaths } from '@cedarjs/project-config'
import {
  cedarCellTransform,
  cedarjsResolveCedarStyleImportsPlugin,
  cedarjsJobPathInjectorPlugin,
  cedarSwapApolloProvider,
} from '@cedarjs/vite'

import { cedarAutoImportsPlugin } from './vite-plugin-cedar-auto-import.js'
import { cedarImportDirPlugin } from './vite-plugin-cedar-import-dir.js'

async function createViteServer(customConfig: UserConfig = {}) {
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
