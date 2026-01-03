// mock Telemetry for CLI commands so they don't try to spawn a process
vi.mock('@cedarjs/telemetry', () => {
  return {
    errorTelemetry: () => vi.fn(),
    timedTelemetry: (_argv, _options, callback) => {
      return callback()
    },
  }
})

vi.mock('@cedarjs/project-config', async (importOriginal) => {
  const originalProjectConfig = await importOriginal()

  return {
    ...originalProjectConfig,
    getPaths: () => {
      return {
        base: '/mocked/project',
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

vi.mock('node:fs', async () => {
  const actualFs = await vi.importActual('node:fs')

  return {
    default: {
      ...actualFs,
      existsSync: (path) => {
        if (path === '/mocked/project/api/prisma.config.js') {
          // Mock the existence of the Prisma config file
          return true
        } else if (path.endsWith('package.json')) {
          // Mock the existence of all packages/<pkg-name>/package.json files
          return true
        }

        return actualFs.existsSync(path)
      },
      readFileSync: (path) => {
        if (path === '/mocked/project/api/package.json') {
          // Mock the existence of the api package.json file
          return JSON.stringify({
            name: '@mocked/project/api',
            version: '1.0.0',
            dependencies: {
              '@mocked/project/web': '1.0.0',
            },
          })
        } else if (path === '/mocked/project/package.json') {
          // It just needs a workspace config section
          return JSON.stringify({
            workspaces: ['api', 'web', 'packages/*'],
          })
        }

        return actualFs.readFileSync(path)
      },
    },
  }
})

import { Listr } from 'listr2'
import { vi, afterEach, test, expect } from 'vitest'

vi.mock('listr2')

// Make sure prerender doesn't get triggered
vi.mock('execa', () => ({
  default: vi.fn((cmd, params) => ({
    cmd,
    params,
  })),
}))

import { handler } from '../buildHandler.js'

afterEach(() => {
  vi.clearAllMocks()
})

test('the build tasks are in the correct sequence', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {})

  await handler({})

  expect(Listr.mock.calls[0][0].map((x) => x.title)).toMatchInlineSnapshot(`
    [
      "Generating Prisma Client...",
      "Building Packages...",
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

  await handler({ workspace: ['web'], prerender: true })
  expect(Listr.mock.calls[0][0].map((x) => x.title)).toMatchInlineSnapshot(`
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
