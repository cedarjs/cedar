import type { CedarHandler } from '@cedarjs/api/runtime'
import { buildCedarContext } from '@cedarjs/api/runtime'

export interface Fetchable {
  fetch(request: Request): Response | Promise<Response>
}

/**
 * Wraps a CedarHandler in a WinterTC-compatible Fetchable.
 *
 * The Fetchable calls buildCedarContext to produce a CedarRequestContext,
 * then delegates to the handler.
 */
export function createCedarFetchable(handler: CedarHandler): Fetchable {
  return {
    async fetch(request: Request): Promise<Response> {
      const ctx = await buildCedarContext(request)
      return handler(request, ctx)
    },
  }
}
