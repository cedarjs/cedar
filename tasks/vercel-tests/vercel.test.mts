import { describe, expect, it } from 'vitest'

function deployUrl() {
  const url = process.env.VERCEL_DEPLOY_URL
  if (!url) {
    throw new Error('VERCEL_DEPLOY_URL environment variable not set.')
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

  it('serves GraphQL endpoint', async () => {
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

  it('validates email via GraphQL createContact mutation', async () => {
    const gql = JSON.stringify({
      query:
        'mutation { createContact(input: { name: "Test", email: "invalid", message: "Hello" }) { id } }',
    })
    const res = await fetchJson(url('/.api/functions/graphql'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: gql,
    })
    expect(res.status).toEqual(200)
    expect(res.body.errors).toBeDefined()
    expect(res.body.errors[0].message).toContain('Invalid email')
  })

  it('validates email via shared @my-org/validators package', async () => {
    const res = await fetchJson(
      url('/.api/functions/hello?email=test@example.com'),
    )
    expect(res.status).toEqual(200)
    expect(res.body).toMatchObject({
      data: 'hello from cedar',
      email: 'test@example.com',
      valid: true,
    })
  })

  it('rejects invalid email via shared @my-org/validators package', async () => {
    const res = await fetchJson(url('/.api/functions/hello?email=invalid'))
    expect(res.status).toEqual(200)
    expect(res.body).toMatchObject({
      data: 'hello from cedar',
      email: 'invalid',
      valid: false,
    })
  })

  it('serves web SPA shell', async () => {
    const res = await fetch(url('/'))
    expect(res.status).toEqual(200)
    const text = await res.text()
    expect(text).toContain('<div id="cedar-app">')
  })
})
