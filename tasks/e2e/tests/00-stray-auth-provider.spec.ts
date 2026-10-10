import { expect, test } from '@playwright/test'

import { GRAPHQL_URL, waitForApiSide } from './helpers.ts'

// Runs before 01-tutorial.spec.ts, while the app is still exactly what
// `create-cedar-app` generated. In particular, nothing has set up auth yet.

test.describe('GraphQL on a freshly created app', () => {
  // A fresh app has no auth set up, so it has no auth decoder and nothing
  // resolves auth state before the GraphQL server reads the request body.
  // Resolving it afterwards would mean cloning an already consumed `Request`,
  // which fails with `Exception in getAuthenticationContext: unusable`.
  //
  // API consumers send `auth-provider` for all sorts of reasons, and a stale
  // cookie left on localhost by another project is enough on its own.
  //
  // It has to be the cookie rather than the header: a cookie sets
  // type/schema/token and so reaches the point where the Lambda-style event is
  // built, while a bare header throws earlier, in `parseAuthorizationHeader`.
  test('handles a stray auth-provider cookie', async ({ request }) => {
    await waitForApiSide(request)

    const res = await request.post(GRAPHQL_URL, {
      headers: {
        'Content-Type': 'application/json',
        Cookie: 'auth-provider=dbAuth',
      },
      data: { query: '{ __typename }' },
      // Assert on the status below so that a 500 reports the body
      failOnStatusCode: false,
    })

    const text = await res.text()

    expect(text).not.toContain('unusable')
    expect(res.status(), text).toBe(200)
    expect(JSON.parse(text).data.__typename).toBe('Query')
  })
})
