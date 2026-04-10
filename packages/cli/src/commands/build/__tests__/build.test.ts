const { mockGetConfig } = vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
}))

vi.mock('@cedarjs/telemetry', () => {
  return {
    errorTelemetry: () => vi.fn(),
    timedTelemetry: (
      _argv: unknown,
      _options: unknown,
      callback: () => unknown,
    ) => {
      return callback()
    },
  }
})

vi.mock('@cedarjs/project-config', () => {
  return {
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
    getConfig: mockGetConfig,
    resolveFile: () => {
      // Used by packages/cli/src/lib/index.js
    },
  }
})

vi.mock('node:fs', () => {
  return {
    default: {
      existsSync: (path: string): boolean | undefined => {
        if (path === '/mocked/project/api/prisma.config.js') {
          // Mock the existence of the Prisma config file
          return true
        } else if (path.endsWith('package.json')) {
          // Mock the existence of all packages/<pkg-name>/package.json files
          return true
        }
        return undefined
      },
      readFileSync: (): string => {
        // Reading /mocked/project/package.json
        // It just needs a workspace config section
        return JSON.stringify({
          workspaces: ['api', 'web', 'packages/*'],
        })
      },
    },
  }
})

// Aggressively mocking a lot of modules here to speed up test
// Without these mocks the "collect" phase of the tests took around 2s
// With these mocks it's down to ~250ms

vi.mock('@cedarjs/internal/dist/build/api', () => ({
  buildApi: vi.fn(),
  cleanApiBuild: vi.fn(),
}))

vi.mock('@cedarjs/internal/dist/generate/generate', () => ({
  generate: vi.fn(),
}))

vi.mock('@cedarjs/internal/dist/validateSchema', () => ({
  loadAndValidateSdls: vi.fn(),
}))

vi.mock('@cedarjs/cli-helpers', () => ({
  colors: Object.fromEntries(
    [
      'error',
      'warning',
      'highlight',
      'success',
      'info',
      'bold',
      'underline',
      'note',
      'tip',
      'important',
      'caution',
      'link',
    ].map((k) => [k, (s) => s]),
  ),
  recordTelemetryAttributes: vi.fn(),
}))

vi.mock('termi-link', () => ({
  terminalLink: vi.fn((text, _url) => text),
}))

vi.mock('../../lib/generatePrismaClient.js', () => ({
  generatePrismaCommand: vi.fn(() => ({ cmd: 'echo', args: [] })),
}))

vi.mock('./buildPackagesTask.js', () => ({
  buildPackagesTask: vi.fn(),
}))

import { Listr } from 'listr2'
import type { ListrTask } from 'listr2'
import { vi, afterEach, beforeEach, test, expect } from 'vitest'

vi.mock('listr2')

// Make sure prerender doesn't get triggered
vi.mock('execa', () => ({
  default: vi.fn((cmd, params) => ({
    cmd,
    params,
  })),
}))

vi.mock('@cedarjs/prerender/detection', () => {
  return { detectPrerenderRoutes: () => [] }
})

import { handler } from '../buildHandler.js'

beforeEach(() => {
  mockGetConfig.mockReturnValue({})
})

afterEach(() => {
  vi.clearAllMocks()
})

test('the build tasks are in the correct sequence when packagesWorkspace is enabled', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  mockGetConfig.mockReturnValue({
    experimental: { packagesWorkspace: { enabled: true } },
  })

  await handler({})

  const firstCallArg = vi.mocked(Listr).mock.calls[0][0]
  const tasks = Array.isArray(firstCallArg) ? firstCallArg : [firstCallArg]
  expect(tasks.map((x: ListrTask) => x.title)).toMatchInlineSnapshot(`
    [
      "Generating Prisma Client...",
      "Building Packages...",
      "Checking workspace packages...",
      "Verifying graphql schema...",
      "Building API...",
      "Building Web...",
    ]
  `)
})

test('the build tasks are in the correct sequence when packagesWorkspace is disabled', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {})

  await handler({})

  const firstCallArg = vi.mocked(Listr).mock.calls[0][0]
  const tasks = Array.isArray(firstCallArg) ? firstCallArg : [firstCallArg]
  expect(tasks.map((x: ListrTask) => x.title)).toMatchInlineSnapshot(`
    [
      "Generating Prisma Client...",
      "Verifying graphql schema...",
      "Building API...",
      "Building Web...",
    ]
  `)
})

test('Should run prerender for web (packagesWorkspace enabled)', async () => {
  const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  mockGetConfig.mockReturnValue({
    experimental: { packagesWorkspace: { enabled: true } },
  })

  await handler({ workspace: ['web'], prerender: true })
  const firstCallArg = vi.mocked(Listr).mock.calls[0][0]
  const tasks = Array.isArray(firstCallArg) ? firstCallArg : [firstCallArg]
  expect(tasks.map((x: ListrTask) => x.title)).toMatchInlineSnapshot(`
    [
      "Checking workspace packages...",
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

test('Should run prerender for web (packagesWorkspace disabled)', async () => {
  const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  // mockGetConfig returns {} by default (set in beforeEach), so packagesWorkspace is disabled

  await handler({ workspace: ['web'], prerender: true })
  const firstCallArg = vi.mocked(Listr).mock.calls[0][0]
  const tasks = Array.isArray(firstCallArg) ? firstCallArg : [firstCallArg]
  expect(tasks.map((x: ListrTask) => x.title)).toMatchInlineSnapshot(`
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
