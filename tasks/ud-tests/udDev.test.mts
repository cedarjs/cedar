import { describe, expect, it } from 'vitest'
import { fs, path, $ } from 'zx'

import {
  FIXTURE_PATH,
  pollForReady,
  sleep,
  testContext,
} from './vitest.setup.mjs'

const WEB_PORT = 18910
const BASE_URL = `http://localhost:${WEB_PORT}`

async function fetchJson(url, init) {
  const res = await fetch(url, init)
  const text = await res.text()
  try {
    return { status: res.status, body: JSON.parse(text) }
  } catch {
    return { status: res.status, body: text }
  }
}

// Resolve the cedar-unified-dev binary path directly so we can test the
// unified dev server without going through `cedar dev --ud` (which requires
// the fixture to be a fully set-up Yarn project with lockfiles).
function resolveUnifiedDevBin() {
  const vitePackagePath = path.resolve(
    import.meta.dirname,
    '../../packages/vite',
  )
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(vitePackagePath, 'package.json'), 'utf-8'),
  )
  return path.resolve(vitePackagePath, packageJson.bin['cedar-unified-dev'])
}

describe('cedar dev --ud', () => {
  it('serves the web SPA shell and API routes with HMR', async () => {
    // 1. Start the unified dev server directly
    const unifiedDevBin = resolveUnifiedDevBin()
    const devProcess = $`yarn node ${unifiedDevBin} --port ${WEB_PORT} --apiPort 18911 --no-open`
    testContext.processes.push(devProcess)

    // 2. Wait for the web server to be ready
    await pollForReady(`${BASE_URL}/`)

    // 3. Web route should return the SPA shell
    const webRes = await fetch(`${BASE_URL}/`)
    expect(webRes.status).toEqual(200)
    const webText = await webRes.text()
    expect(webText).toContain('<div id="redwood-app">')
    expect(webText).toContain('<script type="module"')

    // 4. Native handleRequest function
    const helloRes = await fetchJson(`${BASE_URL}/.api/functions/hello`)
    expect(helloRes.status).toEqual(200)
    expect(helloRes.body).toEqual({ data: 'hello from cedar' })

    // 5. Legacy handler function (wrapped automatically)
    const legacyRes = await fetchJson(`${BASE_URL}/.api/functions/legacyHello`)
    expect(legacyRes.status).toEqual(200)
    expect(legacyRes.body).toEqual({ data: 'hello from legacy handler' })

    // 6. GraphQL endpoint
    const gqlRes = await fetchJson(`${BASE_URL}/.api/functions/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ hello }' }),
    })
    expect(gqlRes.status).toEqual(200)
    expect(gqlRes.body).toMatchObject({
      data: { hello: 'Hello from Cedar GraphQL' },
    })

    // 7. HMR: modify the API function source and expect the change to be reflected
    const helloSrcPath = `${FIXTURE_PATH}/api/src/functions/hello.ts`
    const originalSrc = fs.readFileSync(helloSrcPath, 'utf-8')
    const updatedSrc = originalSrc.replace(
      'hello from cedar',
      'hello from cedar (updated)',
    )

    fs.writeFileSync(helloSrcPath, updatedSrc)

    try {
      // Poll until the updated response is returned (or timeout)
      let updated = false
      for (let i = 0; i < 40; i++) {
        await sleep(250)
        const res = await fetchJson(`${BASE_URL}/.api/functions/hello`)
        if (
          res.status === 200 &&
          res.body?.data === 'hello from cedar (updated)'
        ) {
          updated = true
          break
        }
      }
      expect(updated).toEqual(true)
    } finally {
      // Always restore the original source
      fs.writeFileSync(helloSrcPath, originalSrc)
    }
  }, 60_000)
})
