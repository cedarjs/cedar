import { describe, expect, it } from 'vitest'

/**
 * Skew protection e2e tests. These run against a site that has been deployed
 * twice: the CI workflow records a hashed asset and the skew token from the
 * first deploy, changes a page so that asset's hash changes, deploys again,
 * and then runs this file with:
 *
 * - NETLIFY_SKEW_PROTECTION_E2E=1
 * - OLD_SKEW_TOKEN: the `cedar-skew-token` cookie value from the first deploy
 * - OLD_ASSET: an asset path (e.g. /assets/AboutPage-abc123.js) that only
 *   exists in the first deploy
 * - NEW_ASSET: the corresponding asset path in the second deploy
 *
 * Both deploys must be built by `netlify deploy` (not `--no-build`), because
 * Netlify only provides NETLIFY_SKEW_PROTECTION_TOKEN to builds it runs.
 */

const COOKIE_NAME = 'cedar-skew-token'

function url(pathname: string) {
  const base = (process.env.DEPLOY_URL ?? '').replace(/\/+$/, '')
  return `${base}${pathname}`
}

function requiredEnv(name: string) {
  const value = process.env[name]

  if (!value) {
    throw new Error(`${name} environment variable must be set`)
  }

  return value
}

function skewTokenFromResponse(res: Response) {
  const cookie = res.headers
    .getSetCookie()
    .find((c) => c.startsWith(`${COOKIE_NAME}=`))

  return cookie?.split(';')[0].slice(COOKIE_NAME.length + 1)
}

describe.skipIf(!process.env.NETLIFY_SKEW_PROTECTION_E2E)(
  'Netlify skew protection',
  () => {
    describe('current deploy', () => {
      it('sets the skew cookie on static HTML served from the CDN', async () => {
        const res = await fetch(url('/'))

        expect(res.status).toEqual(200)
        expect(skewTokenFromResponse(res)).toBeTruthy()
      })

      it('sets the skew cookie on API function responses', async () => {
        const res = await fetch(url('/.api/functions/hello'))

        expect(res.status).toEqual(200)
        expect(skewTokenFromResponse(res)).toBeTruthy()
      })

      it('uses the same token for HTML and API responses', async () => {
        const htmlToken = skewTokenFromResponse(await fetch(url('/')))
        const apiToken = skewTokenFromResponse(
          await fetch(url('/.api/functions/hello')),
        )

        expect(htmlToken).toEqual(apiToken)
      })

      it('uses a different token than the previous deploy', async () => {
        const token = skewTokenFromResponse(await fetch(url('/')))

        expect(token).not.toEqual(requiredEnv('OLD_SKEW_TOKEN'))
      })

      it('serves the current deploy’s assets without a token', async () => {
        const res = await fetch(url(requiredEnv('NEW_ASSET')))

        expect(res.status).toEqual(200)
      })
    })

    describe('previous deploy', () => {
      it('does not serve old assets without a token', async () => {
        const res = await fetch(url(requiredEnv('OLD_ASSET')))

        expect(res.status).toEqual(404)
      })

      it('does not serve old assets with an unknown token', async () => {
        const res = await fetch(url(requiredEnv('OLD_ASSET')), {
          headers: { cookie: `${COOKIE_NAME}=not-a-real-token` },
        })

        expect(res.status).toEqual(404)
      })

      it('serves old assets when the token is sent as a cookie', async () => {
        const res = await fetch(url(requiredEnv('OLD_ASSET')), {
          headers: {
            cookie: `${COOKIE_NAME}=${requiredEnv('OLD_SKEW_TOKEN')}`,
          },
        })

        expect(res.status).toEqual(200)
        expect(res.headers.get('content-type')).toContain('javascript')
      })

      it('serves old assets when the token is sent as a header', async () => {
        const res = await fetch(url(requiredEnv('OLD_ASSET')), {
          headers: { [COOKIE_NAME]: requiredEnv('OLD_SKEW_TOKEN') },
        })

        expect(res.status).toEqual(200)
      })

      it('serves old assets when the token is sent as a query param', async () => {
        const token = encodeURIComponent(requiredEnv('OLD_SKEW_TOKEN'))
        const res = await fetch(
          url(`${requiredEnv('OLD_ASSET')}?skew=${token}`),
        )

        expect(res.status).toEqual(200)
      })
    })
  },
)
