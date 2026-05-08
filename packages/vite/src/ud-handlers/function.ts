import { pathToFileURL } from 'node:url'

import { wrapLegacyHandler } from '@cedarjs/api/runtime'
import type { CedarHandler, LegacyHandler } from '@cedarjs/api/runtime'
import { createCedarFetchable } from '@cedarjs/api-server/udFetchable'

export interface FunctionHandlerOptions {
  distPath: string
}

export function createFunctionHandler(options: FunctionHandlerOptions) {
  const handleRequest: CedarHandler = async (request, ctx) => {
    const mod = await import(pathToFileURL(options.distPath).href)

    // Prefer the new Fetch-native handleRequest shape.
    const nativeHandler = mod.handleRequest || mod.default?.handleRequest
    if (nativeHandler) {
      return nativeHandler(request, ctx)
    }

    // Fall back to the legacy Lambda-shaped handler and wrap it.
    const legacyHandler = mod.handler || mod.default?.handler
    if (legacyHandler) {
      return wrapLegacyHandler(legacyHandler as LegacyHandler)(request, ctx)
    }

    throw new Error(
      `Handler not found in ${options.distPath}. Expected ` +
        '`export async function handleRequest(request, ctx)`, ' +
        '`export default { handleRequest }`, ' +
        'or a legacy Lambda-shaped `handler`.',
    )
  }

  return createCedarFetchable(handleRequest)
}
