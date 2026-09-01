import { test, expect } from '@playwright/test'

/**
 * The same-site happy path: a real OIDC provider (`oauth2-mock-server`,
 * started in global setup on `localhost`, a different port from the app but
 * the same site) driven through the genuine
 * discovery/PKCE/id_token-verification flow -- see `global-setup.ts` and
 * `createOidcStrategy` in `@cedarjs/auth-dbauth-oauth`.
 *
 * Unlike the in-package integration tests (which drive `OAuthHandler`
 * directly with constructed requests), this rides the real redirects a
 * browser makes: clicking the generated "Continue with..." link, landing on
 * the mock provider's `/authorize` endpoint (which auto-approves without
 * any credentials, matching how `oauth2-mock-server` behaves with no
 * `beforeAuthorizeRedirect`/consent hook registered), and landing back in
 * the app -- proving the transaction cookie and the session cookie both
 * survive the round trip for real, and that the generated login page is
 * actually wired up to the provider.
 */
test('logs in with the mock OIDC provider and mints a real session', async ({
  page,
}) => {
  await page.goto('/login')

  await page.getByTestId('oauth-mock-login').click()

  await page.waitForURL('http://localhost:8910/')

  // The session cookie dbAuth mints is `HttpOnly` -- reading it back via
  // `document.cookie` would always come back empty whether or not it's
  // `HttpOnly`, so the only way to prove that attribute for real is through
  // the browser context's own cookie jar, which Playwright exposes
  // regardless of `HttpOnly`.
  const cookies = await page.context().cookies()
  const sessionCookie = cookies.find((cookie) =>
    cookie.name.startsWith('session'),
  )

  expect(sessionCookie).toBeTruthy()
  expect(sessionCookie?.httpOnly).toBe(true)

  // Prove the session is real (not just a cookie that happens to exist) by
  // round-tripping it through an authenticated GraphQL `currentUser` call --
  // the same one `useAuth()` makes, exercised here via the profile page.
  await page.goto('/profile')

  const isAuthenticatedRow = await page.waitForSelector(
    '*css=tr >> text=isAuthenticated',
  )
  expect(await isAuthenticatedRow.innerHTML()).toBe(
    '<td>isAuthenticated</td><td>true</td>',
  )

  const emailRow = await page.waitForSelector('*css=tr >> text=EMAIL')
  expect(await emailRow.innerHTML()).toBe(
    '<td>EMAIL</td><td>oauth-mock@example.com</td>',
  )
})
