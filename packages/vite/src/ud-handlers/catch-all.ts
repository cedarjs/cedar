import { createRouter, addRoute, findRoute } from 'rou3'

export interface CatchAllRoute {
  path: string
  methods: string[]
  module: { fetch: (request: Request) => Promise<Response> | Response }
}

export interface CatchAllHandlerOptions {
  routes: CatchAllRoute[]
  apiRootPath: string
}

export function createCatchAllHandler(options: CatchAllHandlerOptions) {
  const router = createRouter<CatchAllRoute['module']>()

  for (const route of options.routes) {
    const methods =
      route.methods.length > 0
        ? route.methods
        : ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']

    for (const method of methods) {
      addRoute(router, method, route.path, route.module)
      addRoute(router, method, `${route.path}/**`, route.module)
    }
  }

  const apiRootPath = options.apiRootPath

  function normalizePathname(requestUrl: string) {
    const url = new URL(requestUrl)
    let pathname = url.pathname

    if (apiRootPath !== '/' && pathname.startsWith(apiRootPath)) {
      pathname = pathname.slice(apiRootPath.length - 1)
    }

    if (!pathname.startsWith('/')) {
      pathname = '/' + pathname
    }

    return pathname
  }

  return {
    async fetch(request: Request): Promise<Response> {
      const pathname = normalizePathname(request.url)
      const match = findRoute(router, request.method, pathname)

      if (!match) {
        return new Response('Not Found', { status: 404 })
      }

      try {
        return await match.data.fetch(request)
      } catch (err) {
        console.error('Unhandled error in fetch handler for', pathname, err)
        return new Response('Internal Server Error', { status: 500 })
      }
    },
  }
}
