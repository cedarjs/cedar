/* eslint-disable no-undef */
/// <reference types="cypress" />

// Runs before tutorial.cy.js, while the app is still exactly what
// `create-cedar-app` generated — in particular, before anything sets up auth.

const BASE_URL = 'http://localhost:8910'
const GRAPHQL_URL = `${BASE_URL}/.api/functions/graphql`

describe('GraphQL on a freshly created app', () => {
  // A fresh app has no auth set up, so it has no auth decoder and nothing
  // resolves auth state before the GraphQL server reads the request body.
  // Resolving it afterwards means cloning an already consumed `Request`, which
  // used to fail the whole request with
  // `Exception in getAuthenticationContext: unusable`.
  //
  // API consumers send `auth-provider` for all sorts of reasons, and a stale
  // cookie left on localhost by another project is enough on its own.
  //
  // It has to be the cookie rather than the header: a cookie sets
  // type/schema/token and so reaches the point where the Lambda-style event is
  // built, while a bare header throws earlier, in `parseAuthorizationHeader`.
  it('handles a stray auth-provider cookie', () => {
    cy.request({
      method: 'POST',
      url: GRAPHQL_URL,
      headers: {
        'Content-Type': 'application/json',
        Cookie: 'auth-provider=dbAuth',
      },
      body: { query: '{ __typename }' },
      // Assert on the status ourselves so a 500 reports the body
      failOnStatusCode: false,
    }).then((res) => {
      expect(JSON.stringify(res.body)).to.not.contain('unusable')
      expect(res.status).to.eq(200)
      expect(res.body.data.__typename).to.eq('Query')
    })
  })
})
