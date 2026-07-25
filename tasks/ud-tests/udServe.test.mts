import { beforeAll, describe, expect, it } from 'vitest'
import { $ } from 'zx'

import {
  autoStop,
  cedar,
  buildFixture,
  pollForReady,
  reservePort,
} from './vitest.setup.mjs'

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init)
  const text = await res.text()
  try {
    return { status: res.status, body: JSON.parse(text) }
  } catch {
    return { status: res.status, body: text }
  }
}

describe('cedar serve api --ud', () => {
  // Build the fixture once before all tests so the build time is not counted
  // against the per-test timeout budget. On a cold CI runner the build can
  // take 60–90 s by itself.
  beforeAll(async () => {
    await buildFixture()
  }, 180_000)

  it('serves API functions, legacy handlers, and GraphQL', async () => {
    // Ports are reserved per test rather than hardcoded, so a server that
    // outlives another test can't stop this one from binding.
    const API_PORT = await reservePort()
    const WEB_PORT = await reservePort()

    // NOTE: `cedar serve --ud` does not exist yet, so we start the API and
    // web servers separately. When both-side UD serving lands, simplify this
    // to a single command.
    // 1. Start the UD API server
    autoStop($`yarn node ${cedar} serve api --ud --port ${API_PORT}`)

    // 2. Start the web server
    autoStop($`yarn node ${cedar} serve web --port ${WEB_PORT}`)

    // 3. Wait for both servers to be ready
    await pollForReady(`http://localhost:${API_PORT}/hello`)
    await pollForReady(`http://localhost:${WEB_PORT}/`)

    // 4. Native handleRequest function (direct API port)
    const helloRes = await fetchJson(`http://localhost:${API_PORT}/hello`)
    expect(helloRes.status).toEqual(200)
    expect(helloRes.body).toEqual({ data: 'hello from cedar' })

    // 5. Legacy handler function (direct API port)
    const legacyRes = await fetchJson(
      `http://localhost:${API_PORT}/legacyHello`,
    )
    expect(legacyRes.status).toEqual(200)
    expect(legacyRes.body).toEqual({ data: 'hello from legacy handler' })

    // 6. GraphQL endpoint (direct API port)
    const gqlRes = await fetchJson(`http://localhost:${API_PORT}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ hello }' }),
    })
    expect(gqlRes.status).toEqual(200)
    expect(gqlRes.body).toMatchObject({
      data: { hello: 'Hello from Cedar GraphQL' },
    })

    // 7. Web route should return the SPA shell
    const webRes = await fetch(`http://localhost:${WEB_PORT}/`)
    expect(webRes.status).toEqual(200)
    const webText = await webRes.text()
    expect(webText).toContain('<div id="cedar-app">')
    expect(webText).toContain('<script type="module"')
  }, 90_000)
})
