import fs from 'node:fs'
import path from 'node:path'

import { catchAllEntry } from '@universal-deploy/store'
import type { Plugin, ResolvedConfig } from 'vite'

import { getPaths } from '@cedarjs/project-config'

import { CEDAR_UNIVERSAL_DEPLOY_PLUGIN_NAME } from './vite-plugin-cedar-universal-deploy.js'
import type { CedarUniversalDeployPluginApi } from './vite-plugin-cedar-universal-deploy.js'

export interface CedarNetlifySkewProtectionPluginOptions {
  headerName?: string
  queryName?: string
  cookieName?: string
  /**
   * How long (in seconds) the skew-token cookie pins a client's asset and API
   * requests to the deploy it last loaded a page from. Page loads are never
   * pinned and always refresh the cookie, so a long value can't keep anyone
   * on an old version; it only bounds how long an open tab can keep loading
   * lazy chunks from the deploy it started on. Defaults to 24 hours.
   */
  cookieMaxAge?: number
}

/**
 * The paths Netlify should route to a client's pinned deploy, and the paths
 * the edge function doesn't need to run on.
 */
export interface SkewProtectionPaths {
  /** Regexes for Netlify's `skew-protection.json` `patterns` */
  patterns: string[]
  /** Globs for the edge function's `excludedPath` */
  excludedPaths: string[]
}

const VIRTUAL_SKEW_TOKEN_ID = 'virtual:cedar-netlify-skew-token'
const RESOLVED_SKEW_TOKEN_ID = '\0' + VIRTUAL_SKEW_TOKEN_ID

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isUniversalDeployPluginApi(
  api: unknown,
): api is CedarUniversalDeployPluginApi {
  return (
    typeof api === 'object' &&
    api !== null &&
    'routes' in api &&
    Array.isArray(api.routes)
  )
}

/**
 * Pins hashed build assets (the lazy-loaded chunks an already-open tab
 * requests after a new deploy) and Cedar's API routes (so an old client keeps
 * talking to the API it was built against). Page loads are not pinned, so a
 * reload or a fresh visit always gets the latest deploy.
 */
export function getSkewProtectionPaths(
  config: Pick<ResolvedConfig, 'base' | 'build' | 'plugins'>,
): SkewProtectionPaths {
  const patterns: string[] = []
  const excludedPaths: string[] = []

  // A `base` that isn't a path (e.g. a CDN URL) means assets aren't served
  // from this site, so there's nothing to pin for them here.
  if (config.base.startsWith('/')) {
    const assetsPath = path.posix.join(config.base, config.build.assetsDir)
    patterns.push(`^${escapeRegExp(assetsPath)}/`)
    excludedPaths.push(`${assetsPath}/*`)
  }

  const udApi = config.plugins.find(
    (plugin) => plugin.name === CEDAR_UNIVERSAL_DEPLOY_PLUGIN_NAME,
  )?.api

  if (isUniversalDeployPluginApi(udApi)) {
    for (const route of udApi.routes) {
      if (route.path.includes('*')) {
        continue
      }

      patterns.push(`^${escapeRegExp(route.path)}(/.*)?$`)
      excludedPaths.push(route.path, `${route.path}/*`)
    }
  }

  return { patterns, excludedPaths }
}

/**
 * Generates Netlify's `.netlify/v1/skew-protection.json` build output, an
 * edge function that stamps the skew-token cookie on static HTML, and wraps
 * Universal Deploy's catch-all Fetchable so server-rendered HTML gets the
 * same cookie.
 *
 * Background: https://docs.netlify.com/build/frameworks/frameworks-api/#netlifyv1skew-protectionjson
 *
 * How it works:
 * - Every HTML response sets `Set-Cookie: <cookieName>=<deploy token>`.
 *   Netlify exposes the token at build time as `NETLIFY_SKEW_PROTECTION_TOKEN`
 *   and at runtime as `context.deploy.skewProtectionToken`.
 * - Requests matching `patterns` (build assets and API routes, see
 *   `getSkewProtectionPaths`) that carry the cookie are served by the deploy
 *   the token belongs to. A tab that loaded an old build keeps loading its
 *   own lazy chunks after a new deploy, instead of getting 404s.
 * - Page loads don't match `patterns`, so they're always served by the
 *   latest deploy, and its HTML sets the latest token. Reloading is therefore
 *   always enough to get the newest version.
 * - Only HTML responses set the cookie. Pinned asset and API responses come
 *   from the old deploy and would otherwise renew the old token.
 *
 * The cookie is set in two places:
 * - Static HTML (prerendered pages and the SPA shell) is served from
 *   Netlify's CDN and never reaches Cedar's server code. A framework-authored
 *   edge function (`.netlify/v1/edge-functions/`, registered automatically)
 *   stamps it using `context.deploy.skewProtectionToken`.
 * - Server-rendered HTML comes from Universal Deploy's catch-all Fetchable.
 *   Fetchables are plain `(request: Request) => Response` functions that
 *   don't get Netlify's `context`, so the build-time token (identical to the
 *   runtime one, both describe the same deploy) is stamped into the SSR
 *   bundle as a virtual module, and the Fetchable is wrapped to set the
 *   cookie.
 *
 * Cookies are the only one of Netlify's three token sources (cookie, header,
 * query) that browsers send automatically, so they're the only one Cedar
 * sets. The header and query sources are registered so clients that can't
 * use cookies can still pin requests by sending the token themselves.
 */
export function cedarNetlifySkewProtectionPlugin(
  options: CedarNetlifySkewProtectionPluginOptions = {},
): Plugin {
  const {
    headerName = 'cedar-skew-token',
    queryName = 'skew',
    cookieName = 'cedar-skew-token',
    cookieMaxAge = 60 * 60 * 24,
  } = options

  const skewToken = process.env.NETLIFY_SKEW_PROTECTION_TOKEN ?? ''

  let skewProtectionPaths: SkewProtectionPaths = {
    patterns: [],
    excludedPaths: [],
  }

  return {
    name: 'cedar-netlify-skew-protection',
    apply: 'build',

    configResolved(config) {
      skewProtectionPaths = getSkewProtectionPaths(config)
    },

    transform(code, id) {
      // Netlify's own function bundler traces reachability from the SSR
      // entry it detects in api/dist/ud (built from virtual:ud:catch-all,
      // Universal Deploy's single server entry). Wrapping that entry's
      // exported Fetchable gives Rollup (and therefore Netlify's bundler) a
      // genuine, traceable reference to the token module, and it's the one
      // place every response from every UD route passes through.
      if (this.environment?.name !== 'ssr' || id !== catchAllEntry) {
        return undefined
      }

      // The generated catch-all module (see @universal-deploy/vite's
      // `catchAll()`) always ends in a single `export default { ...,
      // async fetch(request, ...args) {...} }`. Renaming that to a local
      // const lets us wrap `.fetch` below before re-exporting it, without
      // needing to parse/regenerate the rest of the (otherwise opaque,
      // externally-owned) module body.
      const wrappedCode = code.replace(
        /^export default \{/m,
        'const __cedarSkewCatchAllHandler = {',
      )

      if (wrappedCode === code) {
        this.warn(
          'cedar-netlify-skew-protection: expected "export default {" in ' +
            'the Universal Deploy catch-all entry but did not find it — ' +
            'skipping skew-token cookie stamping on server-rendered HTML. ' +
            'This likely means @universal-deploy/vite changed how it ' +
            'generates the catch-all entry.',
        )
        return undefined
      }

      return {
        code: [
          `import { CEDAR_SKEW_TOKEN, CEDAR_SKEW_COOKIE_NAME } from ${JSON.stringify(VIRTUAL_SKEW_TOKEN_ID)}`,
          wrappedCode,
          '',
          'const __cedarSkewOriginalFetch =',
          '  __cedarSkewCatchAllHandler.fetch.bind(__cedarSkewCatchAllHandler)',
          '',
          '__cedarSkewCatchAllHandler.fetch = async (request, ...args) => {',
          '  const response = await __cedarSkewOriginalFetch(request, ...args)',
          '',
          '  // Only HTML responses set the cookie (see',
          '  // vite-plugin-cedar-netlify-skew-protection.ts). Nothing to stamp',
          '  // without a token (e.g. a local `cedar build --ud` run outside a',
          '  // Netlify build) or a response (an unmatched route). Statuses',
          '  // outside 200-599 (e.g. 101 for a WebSocket upgrade) make the',
          '  // Response constructor below throw, and 204/304 responses have no',
          '  // body worth re-wrapping. Responses that already set our cookie',
          '  // are left alone to avoid a duplicate.',
          '  if (',
          '    !CEDAR_SKEW_TOKEN ||',
          '    !response ||',
          '    response.status < 200 ||',
          '    response.status > 599 ||',
          '    response.status === 204 ||',
          '    response.status === 304 ||',
          '    !(response.headers.get("content-type") ?? "").includes("text/html") ||',
          '    (response.headers.get("set-cookie") ?? "").includes(',
          '      `${CEDAR_SKEW_COOKIE_NAME}=`,',
          '    )',
          '  ) {',
          '    return response',
          '  }',
          '',
          '  const headers = new Headers(response.headers)',
          '  headers.append(',
          '    "set-cookie",',
          `    \`\${CEDAR_SKEW_COOKIE_NAME}=\${CEDAR_SKEW_TOKEN}; Path=/; Max-Age=${cookieMaxAge}; HttpOnly; Secure; SameSite=Lax\`,`,
          '  )',
          '',
          '  return new Response(response.body, {',
          '    status: response.status,',
          '    statusText: response.statusText,',
          '    headers,',
          '  })',
          '}',
          '',
          'export default __cedarSkewCatchAllHandler',
        ].join('\n'),
        map: null,
      }
    },

    resolveId(id) {
      if (id === VIRTUAL_SKEW_TOKEN_ID) {
        return RESOLVED_SKEW_TOKEN_ID
      }

      return undefined
    },

    load(id) {
      if (id !== RESOLVED_SKEW_TOKEN_ID) {
        return undefined
      }

      return [
        `export const CEDAR_SKEW_TOKEN = ${JSON.stringify(skewToken)}`,
        `export const CEDAR_SKEW_HEADER_NAME = ${JSON.stringify(headerName)}`,
        `export const CEDAR_SKEW_QUERY_NAME = ${JSON.stringify(queryName)}`,
        `export const CEDAR_SKEW_COOKIE_NAME = ${JSON.stringify(cookieName)}`,
        '',
      ].join('\n')
    },

    writeBundle() {
      // Netlify reads Frameworks API output from `.netlify/v1/` relative to
      // the package being built (`web/`), not from the publish directory
      // (`web/dist`). It's the same directory `@netlify/vite-plugin` writes
      // its functions to. Only the client build's writeBundle needs to emit
      // these files.
      if (this.environment?.name !== 'client') {
        return
      }

      if (!skewToken) {
        // Not building in a Netlify build environment (e.g. a local
        // `cedar build --ud` run) — nothing to stamp.
        return
      }

      const netlifyV1Dir = path.join(getPaths().web.base, '.netlify', 'v1')
      fs.mkdirSync(netlifyV1Dir, { recursive: true })

      const manifest = {
        patterns: skewProtectionPaths.patterns,
        sources: [
          { type: 'header', name: headerName },
          { type: 'query', name: queryName },
          { type: 'cookie', name: cookieName },
        ],
      }

      fs.writeFileSync(
        path.join(netlifyV1Dir, 'skew-protection.json'),
        JSON.stringify(manifest, null, 2) + '\n',
      )

      const edgeFunctionsDir = path.join(netlifyV1Dir, 'edge-functions')
      fs.mkdirSync(edgeFunctionsDir, { recursive: true })

      fs.writeFileSync(
        path.join(edgeFunctionsDir, 'cedar-skew-cookie.js'),
        [
          '// Generated by @cedarjs/vite. Stamps the skew-protection cookie on',
          "// static HTML served from Netlify's CDN. See",
          '// vite-plugin-cedar-netlify-skew-protection.ts for the full picture.',
          'export default async (request, context) => {',
          '  const response = await context.next()',
          '',
          `  const cookieName = ${JSON.stringify(cookieName)}`,
          '',
          '  // Only HTML responses set the cookie. Statuses outside 200-599',
          '  // (e.g. 101 for a WebSocket upgrade) make the Response',
          '  // constructor below throw, and 204/304 responses have no body',
          '  // worth re-wrapping. Responses that already set our cookie (from',
          '  // the Universal Deploy wrapper) are left alone.',
          '  if (',
          '    response.status < 200 ||',
          '    response.status > 599 ||',
          '    response.status === 204 ||',
          '    response.status === 304 ||',
          '    !(response.headers.get("content-type") ?? "").includes("text/html") ||',
          '    (response.headers.get("set-cookie") ?? "").includes(`${cookieName}=`)',
          '  ) {',
          '    return response',
          '  }',
          '',
          '  const token = context.deploy?.skewProtectionToken',
          '  if (!token) {',
          '    return response',
          '  }',
          '',
          '  const headers = new Headers(response.headers)',
          '  headers.append(',
          '    "set-cookie",',
          `    \`\${cookieName}=\${token}; Path=/; Max-Age=${cookieMaxAge}; HttpOnly; Secure; SameSite=Lax\`,`,
          '  )',
          '',
          '  return new Response(response.body, {',
          '    status: response.status,',
          '    statusText: response.statusText,',
          '    headers,',
          '  })',
          '}',
          '',
          'export const config = {',
          '  path: "/*",',
          `  excludedPath: ${JSON.stringify(skewProtectionPaths.excludedPaths)},`,
          '}',
          '',
        ].join('\n'),
      )
    },
  }
}
