import type FS from 'node:fs'

import { Listr } from 'listr2'
import { vi, afterEach, test, expect } from 'vitest'

import type * as ProjectConfig from '@cedarjs/project-config'

vi.mock('listr2')

// Make sure prerender doesn't get triggered
vi.mock('@cedarjs/project-config', async (importOriginal) => {
  const originalProjectConfig = await importOriginal<typeof ProjectConfig>()
  return {
    ...originalProjectConfig,
    getPaths: () => {
      return {
        api: {
          dist: '/mocked/project/api/dist',
          prismaConfig: '/mocked/project/api/prisma.config.js',
        },
        web: {
          dist: '/mocked/project/web/dist',
          routes: '/mocked/project/web/Routes.tsx',
        },
      }
    },
    getConfig: () => {
      return {
        // The build command needs nothing in this config as all
        // the values it currently reads are optional.
      }
    },
  }
})

vi.mock('node:fs', async (importOriginal) => {
  const actualFs = await importOriginal<typeof FS>()

  return {
    default: {
      ...actualFs,
      // Mock the existence of the Prisma config file
      existsSync: (path: string) => {
        if (path === '/mocked/project/api/prisma.config.js') {
          return true
        }

        return actualFs.existsSync(path)
      },
    },
  }
})

vi.mock('execa', () => ({
  default: vi.fn((cmd, params) => ({
    cmd,
    params,
  })),
}))

import { handler } from '../build.js'

afterEach(() => {
  vi.clearAllMocks()
})

test('the build tasks are in the correct sequence', async () => {
  await handler({})
  const callArgs = vi.mocked(Listr).mock.calls[0][0] as { title: string }[]
  expect(callArgs.map((x) => x.title)).toMatchInlineSnapshot(`
    [
      "Generating Prisma Client...",
      "Verifying graphql schema...",
      "Building API...",
      "Building Web...",
    ]
  `)
})

vi.mock('@cedarjs/prerender/detection', () => {
  return { detectPrerenderRoutes: () => [] }
})

test('Should run prerender for web', async () => {
  const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

  await handler({ side: ['web'], prerender: true })
  const callArgs = vi.mocked(Listr).mock.calls[0][0] as { title: string }[]
  expect(callArgs.map((x) => x.title)).toMatchInlineSnapshot(`
    [
      "Building Web...",
    ]
  `)

  // Run prerendering task, but expect warning,
  // because `detectPrerenderRoutes` is empty.
  expect(consoleSpy.mock.calls[0][0]).toBe('Starting prerendering...')
  expect(consoleSpy.mock.calls[1][0]).toMatch(
    /You have not marked any routes to "prerender"/,
  )
})
