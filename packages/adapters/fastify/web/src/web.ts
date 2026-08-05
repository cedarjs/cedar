import fs from 'node:fs'
import path from 'path'

import fastifyCompress from '@fastify/compress'
import httpProxy from '@fastify/http-proxy'
import fastifyStatic from '@fastify/static'
import fastifyUrlData from '@fastify/url-data'
import fg from 'fast-glob'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { getPaths } from '@cedarjs/project-config'

import { coerceRootPath } from './helpers.js'
import { resolveOptions } from './resolveOptions.js'
import type { RedwoodFastifyWebOptions } from './types.js'

export { coerceRootPath }
export type { RedwoodFastifyWebOptions }

const ONE_YEAR_IN_SECONDS = 60 * 60 * 24 * 365

export async function redwoodFastifyWeb(
  fastify: FastifyInstance,
  opts: RedwoodFastifyWebOptions,
) {
  const { redwoodOptions, flags } = resolveOptions(opts)

  fastify.register(fastifyUrlData)

  // Registered before `fastifyStatic` so its `onSend` hook — added via
  // `fastify-plugin`, so it isn't encapsulated to this registration — is in
  // place for every route defined below.
  fastify.register(fastifyCompress)

  // Vite content-hashes everything under `assets/`, so those files can be
  // cached forever. Nothing else is hashed — most importantly `index.html`
  // and the other prerendered HTML entry points — so it all has to stay
  // revalidate-on-every-request, or a deploy wouldn't be picked up.
  //
  // `cacheControl: false` turns off `@fastify/static`'s own Cache-Control
  // handling. It's not just redundant with `setHeaders` below, it actively
  // conflicts: `@fastify/static` calls `setHeaders` and *then* writes its own
  // Cache-Control header afterwards, clobbering whatever we set here.
  const assetsDir = path.join(getPaths().web.dist, 'assets') + path.sep

  fastify.register(fastifyStatic, {
    root: getPaths().web.dist,
    cacheControl: false,
    setHeaders: (res, filePath) => {
      res.setHeader(
        'Cache-Control',
        filePath.startsWith(assetsDir)
          ? `public, max-age=${ONE_YEAR_IN_SECONDS}, immutable`
          : 'no-cache',
      )
    },
  })

  // If `apiProxyTarget` is set, proxy requests from `apiUrl` to `apiProxyTarget`.
  // In this case, `apiUrl` has to be relative; `resolveOptions` above throws if it's not
  if (redwoodOptions.apiProxyTarget) {
    fastify.register(httpProxy, {
      prefix: redwoodOptions.apiUrl,
      upstream: redwoodOptions.apiProxyTarget,
      disableCache: true,
      replyOptions: {
        rewriteRequestHeaders: (req, headers) => ({
          ...headers,
          // preserve the original host header, instead of letting it be overwritten by the proxy
          host: req.headers.host,
        }),
      },
    })
  }

  // If `shouldRegisterApiUrl` is true, `apiUrl` has to be defined
  // but TS doesn't know that so it complains about `apiUrl` being undefined
  // in `fastify.all(...)` below. So we have to do this check for now
  if (redwoodOptions.apiUrl && flags.shouldRegisterApiUrl) {
    const apiUrlHandler = (_req: FastifyRequest, reply: FastifyReply) => {
      reply.code(200)
      reply.send({
        data: null,
        errors: [
          {
            message: `Bad Gateway: you may have misconfigured apiUrl and apiProxyTarget. If apiUrl is a relative URL, you must provide apiProxyTarget.`,
            extensions: {
              code: 'BAD_GATEWAY',
              httpStatus: 502,
            },
          },
        ],
      })
    }

    const apiUrlWarningPath = coerceRootPath(redwoodOptions.apiUrl)

    fastify.all(apiUrlWarningPath, apiUrlHandler)
    fastify.all(`${apiUrlWarningPath}*`, apiUrlHandler)
  }

  // Serve prerendered files directly, instead of the index
  const prerenderedFiles = await fg('**/*.html', {
    cwd: getPaths().web.dist,
    ignore: ['index.html', '200.html', '404.html'],
  })

  for (const prerenderedFile of prerenderedFiles) {
    const [pathName] = prerenderedFile.split('.html')
    fastify.get(`/${pathName}`, (_, reply) => {
      reply.header('Content-Type', 'text/html; charset=UTF-8')
      reply.sendFile(prerenderedFile)
    })
  }

  // If `200.html` exists, the project has been prerendered.
  // If it doesn't, fallback to the default (`index.html`)
  const prerenderIndexPath = path.join(getPaths().web.dist, '200.html')
  const fallbackIndexPath = fs.existsSync(prerenderIndexPath)
    ? '200.html'
    : 'index.html'

  // For SPA routing, fallback on unmatched routes and let client-side routing take over
  fastify.setNotFoundHandler({}, (req, reply) => {
    const urlData = req.urlData()
    const requestHasExtension = !!path.extname(urlData.path ?? '')

    // Further up in this file we use `fastifyStatic` to serve files from the
    // /web/dist folder. Most often for files like AboutPage-12ab34cd.js or
    // some css file.
    // Requests for other paths should most often be handled by client side
    // routing. Like requests /about or /about.html.
    // One exception for this is requests for assets that don't exist anymore.
    // Like AboutPage-old_hash.js. These requests should return 404.
    // The problem is we don't know what those assets are. So the best we can
    // do is to return 404 for all requests for files in /assets that have an
    // extension.
    //
    // See the discussions in https://github.com/redwoodjs/redwood/pull/9272
    // and https://github.com/redwoodjs/redwood/issues/9969

    if (requestHasExtension && urlData.path?.startsWith('/assets/')) {
      // If we got here, the user is most likely requesting an asset with an
      // extension (like `assets/AboutPage-xyz789.js`) that doesn't exist
      //
      // NOTE: This is a best guess, and could be wrong. The user could have
      // a client-side route setup for /assets/client-side/{...} and in that
      // case we really should pass this on to the client-side router instead
      // of returning 404.
      reply.code(404)
      return reply.send('Not Found')
    }

    // Let client-side routing take over
    reply.header('Content-Type', 'text/html; charset=UTF-8')
    return reply.sendFile(fallbackIndexPath)
  })
}
