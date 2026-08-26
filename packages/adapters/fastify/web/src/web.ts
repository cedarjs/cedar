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

// Vite's default `assetFileNames`/`entryFileNames`/`chunkFileNames` all end
// in `-<hash>.<ext>`. A project can override those in its own vite.config to
// emit stable filenames instead — in which case a file living under
// `assets/` is no longer a safe signal on its own that it's safe to cache
// forever, so the filename itself has to look hashed too.
const HASHED_ASSET_FILENAME = /-[0-9a-f]{8,}\.[^./]+$/i

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
  // `cacheControl: false` disables `@fastify/static`'s own Cache-Control
  // handling, so the header set in `setHeaders` below is the only one.
  const assetsDir = path.join(getPaths().web.dist, 'assets') + path.sep

  fastify.register(fastifyStatic, {
    root: getPaths().web.dist,
    cacheControl: false,
    setHeaders: (reply, filePath) => {
      const isHashedAsset =
        filePath.startsWith(assetsDir) &&
        HASHED_ASSET_FILENAME.test(path.basename(filePath))

      reply.header(
        'Cache-Control',
        isHashedAsset
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
