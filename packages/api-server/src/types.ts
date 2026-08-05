import type { FastifyInstance } from 'fastify'

import type { CedarFastifyAPIOptions } from './plugins/api.js'

// Types for using server.config.js
export type FastifySideConfigFnOptions = {
  side: 'api' | 'web'
}

export type FastifySideConfigFn = (
  fastify: FastifyInstance,
  options?: FastifySideConfigFnOptions &
    Pick<CedarFastifyAPIOptions['cedar'], 'apiRootPath'>,
) => Promise<FastifyInstance> | void

export type APIParsedOptions = {
  port?: number
  host?: string
  loadEnvFiles?: boolean
} & Omit<CedarFastifyAPIOptions['cedar'], 'fastGlobOptions'>

export type BothParsedOptions = {
  webPort?: number
  webHost?: string
  apiPort?: number
  apiHost?: string
  apiRootPath?: string
} & Omit<CedarFastifyAPIOptions['cedar'], 'fastGlobOptions'>
