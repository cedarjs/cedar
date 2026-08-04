import { vi, describe, it, expect } from 'vitest'

vi.mock('../../../../lib/index.js', async (importOriginal) => {
  const originalLib = await importOriginal<object>()

  return {
    ...originalLib,
    getPaths: () => ({ base: '/mock/project/my-cedar-app' }),
  }
})

vi.mock('../helpers/index.js', async (importOriginal) => {
  const originalHelpers = await importOriginal<object>()

  return {
    ...originalHelpers,
    getUserApiUrl: () => '/.api/functions',
  }
})

const { RENDER_YAML, POSTGRES_YAML, SQLITE_YAML } =
  await import('../templates/render.js')

describe('render.yaml', () => {
  const yaml = RENDER_YAML(POSTGRES_YAML)

  // `env` is the pre-2024 spelling. Render's blueprint spec now says it's
  // "still supported but is discouraged", so this guards against a revert.
  it('uses `runtime` rather than the discouraged `env`', () => {
    expect(yaml).toContain('runtime: static')
    expect(yaml).toContain('runtime: node')
    expect(yaml).not.toMatch(/^\s+env:\s/m)
  })

  it('publishes the web side statically and serves the api as a node service', () => {
    expect(yaml).toContain('staticPublishPath: ./web/dist')
    expect(yaml).toContain('startCommand: yarn cedar deploy render api')
  })

  it('keeps the SPA fallback and the api rewrite', () => {
    expect(yaml).toContain('destination: /200.html')
    expect(yaml).toContain('source: /.api/functions/*')
  })

  it('links Cedar docs first, and labels the Redwood walkthrough as pre-fork', () => {
    expect(yaml).toContain('https://cedarjs.com/docs/deploy/render')
    // Render's own guide is still linked deliberately — it predates the fork
    // and uses `rw` naming, but nothing in it stopped applying to Cedar. The
    // comment must say so, not just link it, so the `rw`/`cedar` mismatch
    // doesn't read as broken docs.
    expect(yaml).toContain('render.com/docs/deploy-redwood')
    expect(yaml).toContain('yarn cedar')
  })

  it('names the api service in the destination placeholder example', () => {
    expect(yaml).toContain('my-cedar-app-api.onrender.com')
    expect(yaml).not.toContain('my-redwood-project-api')
  })

  it('wires DATABASE_URL from the declared database for postgres', () => {
    expect(yaml).toContain('fromDatabase:')
    expect(yaml).toContain('property: connectionString')
  })

  it('mounts a disk instead of a database for sqlite', () => {
    const sqliteYaml = RENDER_YAML(SQLITE_YAML)

    expect(sqliteYaml).toContain('mountPath:')
    expect(sqliteYaml).not.toContain('fromDatabase:')
  })
})
