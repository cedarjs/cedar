import { describe, expect, it } from 'vitest'

function deployUrl() {
  const url = process.env.DEPLOY_URL
  if (!url) {
    throw new Error(
      'DEPLOY_URL environment variable not set. ' +
        'Run with VERCEL_DEPLOY_URL set.',
    )
  }
  return url
}

function url(pathname: string) {
  const base = deployUrl().replace(/\/+$/, '')
  const normalized = pathname.startsWith('/') ? pathname : `/${pathname}`
  return `${base}${normalized}`
}

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init)
  const text = await res.text()
  try {
    return { status: res.status, body: JSON.parse(text) }
  } catch {
    return { status: res.status, body: text }
  }
}

describe('Vercel deployment', () => {
  it('serves API handleRequest functions', async () => {
    const res = await fetchJson(url('/.api/functions/hello'))
    expect(res.status).toEqual(200)
    expect(res.body).toMatchObject({ data: 'hello from cedar' })
  })

  it('serves legacy Lambda-style handlers', async () => {
    const res = await fetchJson(url('/.api/functions/legacyHello'))
    expect(res.status).toEqual(200)
    expect(res.body).toEqual({ data: 'hello from legacy handler' })
  })

  // GraphQL handler returns 502 when routed through the `server` function wrapper
  // because `createGraphQLHandler` (legacy handler) returns an APIGateway-style
  // response which the UD catch-all doesn't convert to a Response correctly for
  // non-trivial handlers. Skipping until fixed upstream.
  it.skip('serves GraphQL endpoint', async () => {
    const gql = JSON.stringify({ query: '{ posts { id } }' })
    const res = await fetchJson(url('/.api/functions/graphql'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: gql,
    })
    expect(res.status).toEqual(200)
    expect(res.body).toMatchObject({
      data: { posts: [] },
    })
  })

  it('serves web SPA shell', async () => {
    const res = await fetch(url('/'))
    expect(res.status).toEqual(200)
    const text = await res.text()
    expect(text).toContain('<div id="cedar-app">')
  })
})
