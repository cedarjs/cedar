import { pathToFileURL } from 'node:url'

import type { CedarHandler } from '@cedarjs/api/runtime'
import { createCedarFetchable } from '@cedarjs/api-server/udFetchable'

export interface FunctionHandlerOptions {
  distPath: string
}

export function createFunctionHandler(options: FunctionHandlerOptions) {
  const handleRequest: CedarHandler = async (request, ctx) => {
    const mod = await import(pathToFileURL(options.distPath).href)
    const handler = mod.handleRequest || mod.default?.handleRequest

    if (!handler) {
      throw new Error(
        `Fetch-native handler not found in ${options.distPath}. Expected ` +
          '`export async function handleRequest(request, ctx)` or ' +
          '`export default { handleRequest }`.',
      )
    }

    return handler(request, ctx)
  }

  return createCedarFetchable(handleRequest)
}
