import fs from 'node:fs/promises'
import path from 'node:path'
import url from 'node:url'

import type { Manifest as ViteBuildManifest } from 'vite'

import { getProjectRoutes } from '@cedarjs/internal/dist/routes.js'
import { getPaths } from '@cedarjs/project-config'

import { getRouteHookDistPath } from './buildRouteHooks.js'
import type { RWRouteManifest } from './types.js'

/**
 * RSC build. Step 6.
 * Generate a route manifest file for the web server side.
 */
export async function buildRouteManifest() {
  const rwPaths = getPaths()

  const buildManifestUrl = url.pathToFileURL(
    path.join(getPaths().web.distBrowser, 'client-build-manifest.json'),
  ).href
  const clientBuildManifest: ViteBuildManifest = (
    await import(buildManifestUrl, { with: { type: 'json' } })
  ).default

  const routesList = getProjectRoutes()

  const routeManifest = routesList.reduce<RWRouteManifest>((acc, route) => {
    acc[route.pathDefinition] = {
      name: route.name,
      bundle: route.relativeFilePath
        ? // @TODO(RSC_DC): this no longer resolves to anything i.e. its always null
          // Because the clientBuildManifest has no pages, because all pages are Server-components?
          // This may be a non-issue, because RSC pages don't need a client bundle per page (or atleast not the same bundle)
          (clientBuildManifest[route.relativeFilePath]?.file ?? null)
        : null,
      matchRegexString: route.matchRegexString,
      // NOTE this is the path definition, not the actual path
      // E.g. /blog/post/{id:Int}
      pathDefinition: route.pathDefinition,
      hasParams: route.hasParams,
      routeHooks: route.routeHooks
        ? getRouteHookDistPath(route.routeHooks)
        : null,
      redirect: route.redirect
        ? {
            to: route.redirect?.to,
            permanent: false,
          }
        : null,
      relativeFilePath: route.relativeFilePath,
      isPrivate: route.isPrivate,
      unauthenticated: route.unauthenticated,
      roles: route.roles,
      pageIdentifier: route.pageIdentifier,
    }

    return acc
  }, {})

  console.log('routeManifest', JSON.stringify(routeManifest, null, 2))

  const webRouteManifest = rwPaths.web.routeManifest
  await fs.mkdir(rwPaths.web.distSsr, { recursive: true })
  return fs.writeFile(webRouteManifest, JSON.stringify(routeManifest, null, 2))
}
