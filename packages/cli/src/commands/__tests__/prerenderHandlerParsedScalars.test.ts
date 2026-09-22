import { afterEach, describe, expect, it, vi } from 'vitest'

import type * as ProjectConfig from '@cedarjs/project-config'
import { getParsedScalars } from '@cedarjs/project-config'

import { getTasks } from '../prerenderHandler.js'

const detection = vi.hoisted(() => ({
  detectPrerenderRoutes: vi.fn(),
}))

vi.mock('@cedarjs/prerender/detection', () => detection)

vi.mock('@cedarjs/project-config', async (importOriginal) => {
  const original = await importOriginal<typeof ProjectConfig>()

  return {
    ...original,
    getParsedScalars: vi.fn(),
  }
})

const prerenderedRoute = {
  name: 'home',
  path: '/',
  routePath: '/',
  filePath: '/path/to/project/web/src/pages/HomePage/HomePage.tsx',
}

afterEach(() => {
  vi.resetAllMocks()
})

describe('getTasks with graphql.parsedScalars', () => {
  it('refuses to prerender when a scalar is parsed', async () => {
    vi.mocked(getParsedScalars).mockReturnValue({ DateTime: 'Date' })
    detection.detectPrerenderRoutes.mockReturnValue([prerenderedRoute])

    await expect(getTasks(false)).rejects.toThrow(
      'Prerendering does not support `graphql.parsedScalars` yet. A ' +
        'prerendered Cell gets the raw GraphQL response, so DateTime would ' +
        'be a string when prerendering and parsed in the browser. Either ' +
        'remove the `prerender` prop from your routes, or remove ' +
        '`graphql.parsedScalars` from cedar.toml.',
    )
  })

  it('does not refuse when no route is marked for prerender', async () => {
    vi.mocked(getParsedScalars).mockReturnValue({ DateTime: 'Date' })
    detection.detectPrerenderRoutes.mockReturnValue([])
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await expect(getTasks(false)).resolves.toEqual([])
  })
})
