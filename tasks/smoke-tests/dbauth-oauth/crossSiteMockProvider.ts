import http from 'node:http'

/**
 * A minimal stand-in for an Apple-shaped OAuth provider: one whose callback
 * arrives as a cross-site `form_post` POST rather than a same-site GET.
 * `oauth2-mock-server` (used for the suite's other, same-site scenario)
 * only advertises `response_modes_supported: ['query']` -- it can't produce
 * a `form_post` callback -- so this tiny server plays the provider's part
 * by hand: it answers the authorize redirect with an auto-submitting HTML
 * form that POSTs a one-time profile straight to the app's callback, the
 * same way Apple POSTs a one-time `user` field.
 *
 * Deliberately skips the real token exchange (issuing a `code`, then having
 * the app trade it for a token) -- that protocol path is already exercised
 * for real by the in-package integration tests
 * (`packages/auth-providers/dbAuth/oauth/src/__tests__`). This suite's job
 * is proving cookie behavior across the cross-site POST, not re-proving the
 * OIDC protocol.
 */
export function startCrossSiteMockProvider(
  port: number,
): Promise<{ close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    if (!req.url || !req.method || req.method !== 'GET') {
      res.writeHead(404).end()
      return
    }

    const url = new URL(req.url, `http://127.0.0.1:${port}`)

    if (url.pathname !== '/authorize') {
      res.writeHead(404).end()
      return
    }

    const redirectUri = url.searchParams.get('redirect_uri')
    const state = url.searchParams.get('state')

    if (!redirectUri || !state) {
      res.writeHead(400).end('missing redirect_uri or state')
      return
    }

    const fields: Record<string, string> = {
      code: 'cross-site-mock-code',
      state,
      providerUserId: 'crosssite-mock-user-1',
      email: 'oauth-crosssite-mock@example.com',
    }

    const inputs = Object.entries(fields)
      .map(
        ([name, value]) =>
          `<input type="hidden" name="${name}" value="${value}">`,
      )
      .join('\n')

    // Auto-submits on load -- there's no real consent screen to click
    // through, the same way `oauth2-mock-server` auto-approves without
    // credentials for the suite's other scenario.
    const body = `<!doctype html>
<html>
  <body onload="document.forms[0].submit()">
    <form method="POST" action="${redirectUri}">
      ${inputs}
    </form>
  </body>
</html>`

    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(body)
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      resolve({
        close: () =>
          new Promise<void>((resolveClose, rejectClose) => {
            server.close((err) => (err ? rejectClose(err) : resolveClose()))
          }),
      })
    })
  })
}
