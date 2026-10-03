import fs from 'node:fs'
import path from 'node:path'

import { catchAllEntry } from '@universal-deploy/store'
import type { Plugin } from 'vite'

import { getPaths } from '@cedarjs/project-config'

export interface CedarNetlifySkewProtectionPluginOptions {
  headerName?: string
  queryName?: string
  cookieName?: string
  /**
   * How long (in seconds) the skew-token cookie should pin a client to this
   * deploy before expiring. Netlify's own guidance is to keep this short to
   * minimize the window where a client could end up pinned to a deploy
   * that's since been cleaned up — but long enough to outlast a normal
   * session. Defaults to 4 hours.
   */
  cookieMaxAge?: number
}

const VIRTUAL_SKEW_TOKEN_ID = 'virtual:cedar-netlify-skew-token'
const RESOLVED_SKEW_TOKEN_ID = '\0' + VIRTUAL_SKEW_TOKEN_ID

/**
 * Generates Netlify's `.netlify/v1/skew-protection.json` build output and
 * stamps the current deploy's skew token into the SSR bundle.
 *
 * Background: https://docs.netlify.com/build/frameworks/frameworks-api/#netlifyv1skew-protectionjson
 * Netlify exposes the current deploy's unique fingerprint at build time via
 * `NETLIFY_SKEW_PROTECTION_TOKEN`, and at runtime via `context.deploy.skewProtectionToken`
 * on the Functions/Edge Functions `context` object. Cedar's universal-deploy
 * entries are plain `(request: Request) => Response` Fetchables with no
 * platform-specific `context` forwarded through, so we can't read the
 * runtime-provided token. Instead we stamp the build-time value (identical
 * to the runtime one — both describe the same deploy) into the bundle as a
 * virtual module, then wrap Universal Deploy's catch-all Fetchable so every
 * response pins the client to this deploy via a `Set-Cookie`. Cookies are
 * the only one of Netlify's three skew-protection sources (cookie, header,
 * query) that propagates for free — the browser resends them on every
 * same-origin request without any client-side code having to attach
 * anything, so that's the only mechanism this phase implements. Header/query
 * propagation would only matter for requests that don't carry cookies (e.g.
 * cross-origin calls), which is a narrower, separate follow-up.
 */
export function cedarNetlifySkewProtectionPlugin(
  options: CedarNetlifySkewProtectionPluginOptions = {},
): Plugin {
  const {
    headerName = 'cedar-skew-token',
    queryName = 'skew',
    cookieName = 'cedar-skew-token',
    cookieMaxAge = 60 * 60 * 4,
  } = options

  const skewToken = process.env.NETLIFY_SKEW_PROTECTION_TOKEN ?? ''

  return {
    name: 'cedar-netlify-skew-protection',
    apply: 'build',

    transform(code, id) {
      // Netlify's own function bundler traces reachability from the SSR
      // entry it detects in api/dist/ud (built from virtual:ud:catch-all,
      // Universal Deploy's single server entry). Wrapping that entry's
      // exported Fetchable here — rather than force-emitting the token
      // module as a standalone chunk — gives Rollup (and therefore
      // Netlify's bundler) a genuine, traceable reference to the token
      // module, and is also the one place every response from every UD
      // route passes through, so it's the natural place to stamp the
      // skew-token cookie onto all of them.
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
            'skipping runtime skew-token cookie propagation. This likely ' +
            'means @universal-deploy/vite changed how it generates the ' +
            'catch-all entry.',
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
          '  // No token (e.g. a local `cedar build --ud` run outside a',
          '  // Netlify build) or no response (an unmatched route) — nothing',
          '  // to stamp.',
          '  if (!CEDAR_SKEW_TOKEN || !response) {',
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
      // web/dist is the directory Netlify actually publishes, so that's
      // where `.netlify/v1/` needs to live. Only the client build's
      // writeBundle fires with that as its output — the api/ssr builds emit
      // elsewhere (api/dist, api/dist/ud).
      if (this.environment?.name !== 'client') {
        return
      }

      if (!skewToken) {
        // Not building in a Netlify build environment (e.g. a local
        // `cedar build --ud` run) — nothing to stamp.
        return
      }

      const netlifyV1Dir = path.join(getPaths().web.dist, '.netlify', 'v1')
      fs.mkdirSync(netlifyV1Dir, { recursive: true })

      const manifest = {
        // Match every path: Cedar can't assume a fixed static-asset
        // directory convention, and Netlify's own docs example matches
        // assets too, so there's no correctness reason to narrow this.
        patterns: ['.*'],
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
    },
  }
}
