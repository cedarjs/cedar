import fs from 'node:fs'
import path from 'node:path'

import type { Plugin } from 'vite'

import { getPaths } from '@cedarjs/project-config'

export interface CedarNetlifySkewProtectionPluginOptions {
  headerName?: string
  queryName?: string
  cookieName?: string
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
 * virtual module, consumed by the runtime cookie/header propagation code.
 */
export function cedarNetlifySkewProtectionPlugin(
  options: CedarNetlifySkewProtectionPluginOptions = {},
): Plugin {
  const {
    headerName = 'cedar-skew-token',
    queryName = 'skew',
    cookieName = 'cedar-skew-token',
  } = options

  const skewToken = process.env.NETLIFY_SKEW_PROTECTION_TOKEN ?? ''

  return {
    name: 'cedar-netlify-skew-protection',
    apply: 'build',

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
      if (this.environment.name !== 'client') {
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
