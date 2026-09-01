import { test, expect } from '@playwright/test'

/**
 * The cross-site `form_post` case the implementation plan calls out
 * specifically (`docs/implementation-plans/2026-09-01-dbauth-oauth.md`,
 * "Testing strategy" -> layer 4): `localhost:8910` and `localhost:8911` are
 * *same-site* (port doesn't factor into "site" at all), so the suite's other
 * scenario doesn't actually exercise cross-site cookie behavior. This one
 * does, by running the mock provider on `127.0.0.1` -- a distinct site from
 * the app's `localhost` -- and having it answer the authorize redirect with
 * an auto-submitting HTML form that POSTs back into the app's callback, the
 * same way Apple's `response_mode=form_post` does (see
 * `crossSiteMockProvider.ts`).
 *
 * This is a real finding, not just a scenario to cover: a cookie with
 * `SameSite=Lax` (the default dbAuth cookie policy) is *not* sent on a
 * cross-site top-level POST navigation -- only on cross-site top-level GET
 * navigations. Without a distinct policy for the transaction cookie, the
 * cookie set at `/authorize` would silently fail to arrive at `/callback`,
 * and the flow would look like a CSRF attack (`error=invalid_state`)
 * instead of a working login. `@cedarjs/auth-dbauth-oauth`'s
 * `transactionCookie` option (`OAuthHandlerOptions.transactionCookie`,
 * independent of the session cookie's `cookie` option) is precisely for
 * this: it lets an app give the transaction cookie `SameSite: 'None'` for
 * this provider without loosening the session cookie's own `SameSite`
 * policy -- see `tasks/test-project/templates/oauth-smoke/api/auth.ts` for
 * how the test project configures it.
 */
test('logs in through a cross-site form_post callback (Apple-shaped provider)', async ({
  page,
}) => {
  await page.goto('/login')

  await page.getByTestId('oauth-crosssite-login').click()

  // Browser hops: localhost:8910 (proxied authorize, sets the transaction
  // cookie) -> 302 to 127.0.0.1:4318/authorize (a different site) -> that
  // page auto-submits a POST back to localhost:8911/auth/oauth/crosssite/callback
  // -> 302 to the app's home page once the transaction cookie is read back
  // successfully.
  await page.waitForURL('http://localhost:8910/')

  const cookies = await page.context().cookies()
  // The dbAuth cookie name is `session_%port%` with the api port filled in;
  // this suite's `webServer` (playwright.config.ts) always runs the api on
  // the fixed port 8911, so the resolved name is exact and stable here.
  const sessionCookie = cookies.find((cookie) => cookie.name === 'session_8911')

  expect(sessionCookie).toBeTruthy()
  expect(sessionCookie?.httpOnly).toBe(true)

  await page.goto('/profile')

  const isAuthenticatedRow = await page.waitForSelector(
    '*css=tr >> text=isAuthenticated',
  )
  expect(await isAuthenticatedRow.innerHTML()).toBe(
    '<td>isAuthenticated</td><td>true</td>',
  )

  const emailRow = await page.waitForSelector('*css=tr >> text=EMAIL')
  expect(await emailRow.innerHTML()).toBe(
    '<td>EMAIL</td><td>oauth-crosssite-mock@example.com</td>',
  )
})
