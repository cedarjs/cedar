import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'

import type { Plugin, ViteDevServer } from 'vite'

import { getConfig, getPaths } from '@cedarjs/project-config'

type Fetchable = { fetch(request: Request): Response | Promise<Response> }

let cachedDispatcher: Fetchable | null = null
// Each invalidation increments this counter. The in-flight build closure
// captures the generation at start and checks it before writing
// cachedDispatcher, so a superseded build never overwrites a newer one.
let dispatcherGeneration = 0
let buildPromise: Promise<Fetchable> | null = null

async function getDispatcher(): Promise<Fetchable> {
  if (cachedDispatcher !== null) {
    return cachedDispatcher
  }

  if (buildPromise !== null) {
    await buildPromise
    // After awaiting, cachedDispatcher may have been populated by a newer
    // build that started after we began waiting. If not, we were invalidated
    // and need to trigger a fresh build.
    return cachedDispatcher ?? getDispatcher()
  }

  // Capture the current generation so we can detect if we've been
  // invalidated by the time the build finishes.
  const generationAtStart = dispatcherGeneration

  buildPromise = (async () => {
    // Recompile api/src/ -> api/dist/ before loading the dispatcher, so the
    // dispatcher always reads fresh build artifacts. We use rebuildApi when a
    // build context already exists (incremental rebuild is faster), and fall
    // back to a full buildApi on the very first run or after a clean.
    try {
      const { rebuildApi, buildApi } =
        await import('@cedarjs/internal/dist/build/api')
      try {
        await rebuildApi()
      } catch {
        // rebuildApi can throw if there is no existing build context yet
        // (e.g. first run). Fall back to a full build.
        await buildApi()
      }
    } catch (err) {
      console.warn(
        '[cedar-dev-dispatcher] API compilation failed; serving with last-known-good dist:',
        err,
      )
    }

    const { buildCedarDispatcher } =
      await import('@cedarjs/api-server/udDispatcher')
    // Pass a cache-bust token so that rebuilt API functions are re-imported
    // rather than served from Node.js's ESM module cache.
    const { fetchable } = await buildCedarDispatcher({ cacheBust: Date.now() })

    // Only commit if we are still the current generation. If invalidate() was
    // called while we were building, a newer build will be (or already is)
    // in-flight and we must not overwrite cachedDispatcher with our stale
    // result.
    if (generationAtStart === dispatcherGeneration) {
      cachedDispatcher = fetchable
    }

    return fetchable
  })()

  try {
    await buildPromise
  } finally {
    // Only clear buildPromise if no invalidate happened during our build.
    // If invalidate DID happen, buildPromise is already null (set by
    // invalidateDispatcher), and a new build may already be in flight.
    if (generationAtStart === dispatcherGeneration) {
      buildPromise = null
    }
  }

  if (cachedDispatcher !== null) {
    return cachedDispatcher
  }

  // We were invalidated during build. Recurse to get the fresh dispatcher.
  return getDispatcher()
}

function invalidateDispatcher() {
  cachedDispatcher = null
  buildPromise = null
  // Increment so any in-flight build can detect it has been superseded.
  dispatcherGeneration++
}

function isViteInternalRequest(url: string): boolean {
  return (
    url.startsWith('/@') ||
    url.startsWith('/__vite') ||
    url.startsWith('/__hmr') ||
    url.includes('?import') ||
    url.includes('?t=') ||
    url.includes('?v=')
  )
}

function isApiRequest(url: string): boolean {
  const cedarConfig = getConfig()
  const apiUrl = cedarConfig.web.apiUrl.replace(/\/$/, '')
  const apiGqlUrl = cedarConfig.web.apiGraphQLUrl ?? apiUrl + '/graphql'

  return (
    url === apiUrl ||
    url.startsWith(apiUrl + '/') ||
    url.startsWith(apiUrl + '?') ||
    url === apiGqlUrl ||
    url.startsWith(apiGqlUrl + '/') ||
    url.startsWith(apiGqlUrl + '?')
  )
}

async function nodeRequestToFetch(req: IncomingMessage): Promise<Request> {
  const host = req.headers.host ?? 'localhost'
  const url = `http://${host}${req.url ?? '/'}`

  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) {
      continue
    }

    if (Array.isArray(value)) {
      for (const v of value) {
        headers.append(key, v)
      }
    } else {
      headers.set(key, value)
    }
  }

  const method = (req.method ?? 'GET').toUpperCase()
  const hasBody = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)

  let body: Buffer | undefined

  if (hasBody) {
    body = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => resolve(Buffer.concat(chunks)))
      req.on('error', reject)
    })
  }

  return new Request(url, {
    method,
    headers,
    body: hasBody && body && body.length > 0 ? new Uint8Array(body) : undefined,
  })
}

async function fetchResponseToNode(
  fetchRes: Response,
  res: ServerResponse,
): Promise<void> {
  res.statusCode = fetchRes.status

  fetchRes.headers.forEach((value, key) => {
    res.setHeader(key, value)
  })

  const bodyBuffer = await fetchRes.arrayBuffer()

  if (bodyBuffer.byteLength > 0) {
    res.end(Buffer.from(bodyBuffer))
  } else {
    res.end()
  }
}

export function cedarDevDispatcherPlugin(): Plugin {
  return {
    name: 'cedar-dev-dispatcher',
    apply: 'serve',

    configureServer(server: ViteDevServer) {
      server.watcher.on('change', (filePath: string) => {
        if (filePath.startsWith(getPaths().api.src + path.sep)) {
          invalidateDispatcher()
        }
      })

      server.middlewares.use(
        async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          const url = req.url ?? '/'

          if (isViteInternalRequest(url)) {
            return next()
          }

          if (!isApiRequest(url)) {
            return next()
          }

          try {
            const dispatcher = await getDispatcher()
            const fetchRequest = await nodeRequestToFetch(req)
            const fetchResponse = await dispatcher.fetch(fetchRequest)
            await fetchResponseToNode(fetchResponse, res)
          } catch (err) {
            console.error(
              '[cedar-dev-dispatcher] Error handling API request:',
              err,
            )

            if (!res.headersSent) {
              res.writeHead(500, { 'Content-Type': 'application/json' })
            }

            res.end(
              JSON.stringify(
                {
                  errors: [
                    {
                      message:
                        err instanceof Error
                          ? err.message
                          : 'Internal Server Error',
                    },
                  ],
                },
                null,
                2,
              ),
            )
          }
        },
      )
    },
  }
}
