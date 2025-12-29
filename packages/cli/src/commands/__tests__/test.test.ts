import fs from 'node:fs'

import execa from 'execa'
import { vi, afterEach, test, expect, beforeEach } from 'vitest'

globalThis.__dirname = import.meta.dirname
import '../../lib/test.js'

vi.mock('execa', () => ({
  default: vi.fn((cmd, params) => ({
    cmd,
    params,
  })),
}))

import { handler } from '../test.js'

vi.mock('@cedarjs/structure', () => {
  return {
    getProject: () => ({
      sides: ['web', 'api'],
    }),
  }
})

beforeEach(() => {
  vi.spyOn(fs, 'existsSync').mockReturnValue(true)
})

afterEach(() => {
  vi.clearAllMocks()
})

const defaultOptions = {
  filter: [],
  watch: false,
  collectCoverage: false,
  dbPush: false,
}

test('Runs tests for all available sides if no filter passed', async () => {
  await handler(defaultOptions)

  expect(vi.mocked(execa).mock.results[0].value.cmd).toBe('yarn')
  expect(vi.mocked(execa).mock.results[0].value.params).toContain('jest')
  expect(vi.mocked(execa).mock.results[0].value.params).toContain('web')
  expect(vi.mocked(execa).mock.results[0].value.params).toContain('api')
})

test('Syncs or creates test database when the flag --db-push is set to true', async () => {
  await handler({ ...defaultOptions, filter: ['api'], dbPush: true })

  expect(vi.mocked(execa).mock.results[0].value.cmd).toBe('yarn')
  expect(vi.mocked(execa).mock.results[0].value.params).toContain('jest')
  expect(vi.mocked(execa).mock.results[0].value.params).toContain('--projects')
  expect(vi.mocked(execa).mock.results[0].value.params).toContain('api')
})

test('Skips test database sync/creation when the flag --db-push is set to false', async () => {
  await handler({ ...defaultOptions, filter: ['api'], dbPush: false })

  expect(vi.mocked(execa).mock.results[0].value.cmd).toBe('yarn')
  expect(vi.mocked(execa).mock.results[0].value.params).toContain('jest')
})

test('Runs tests for all available sides if no side filter passed', async () => {
  await handler({
    ...defaultOptions,
    filter: ['bazinga'],
  })

  expect(vi.mocked(execa).mock.results[0].value.cmd).toBe('yarn')
  expect(vi.mocked(execa).mock.results[0].value.params).toContain('jest')
  expect(vi.mocked(execa).mock.results[0].value.params).toContain('bazinga')
  expect(vi.mocked(execa).mock.results[0].value.params).toContain('web')
  expect(vi.mocked(execa).mock.results[0].value.params).toContain('api')
})

test('Runs tests specified side if even with additional filters', async () => {
  await handler({ ...defaultOptions, filter: ['web', 'bazinga'] })

  expect(vi.mocked(execa).mock.results[0].value.cmd).not.toBe('yarn rw')
  expect(vi.mocked(execa).mock.results[0].value.params).not.toContain('api')

  expect(vi.mocked(execa).mock.results[0].value.cmd).toBe('yarn')
  expect(vi.mocked(execa).mock.results[0].value.params).toContain('jest')
  expect(vi.mocked(execa).mock.results[0].value.params).toContain('bazinga')
  expect(vi.mocked(execa).mock.results[0].value.params).toContain('web')
})

test('Does not create db when calling test with just web', async () => {
  await handler({
    ...defaultOptions,
    filter: ['web'],
  })

  expect(vi.mocked(execa).mock.results[0].value.cmd).toBe('yarn')
  expect(vi.mocked(execa).mock.results[0].value.params).toContain('jest')
})

test('Passes filter param to jest command if passed', async () => {
  await handler({ ...defaultOptions, filter: ['web', 'bazinga'] })

  expect(vi.mocked(execa).mock.results[0].value.cmd).toBe('yarn')
  expect(vi.mocked(execa).mock.results[0].value.params).toContain('jest')
  expect(vi.mocked(execa).mock.results[0].value.params).toContain('bazinga')
})

test('Passes other flags to jest', async () => {
  await handler({
    ...defaultOptions,
    u: true,
    debug: true,
    json: true,
    collectCoverage: true,
  })

  expect(vi.mocked(execa).mock.results[0].value.cmd).toBe('yarn')
  expect(vi.mocked(execa).mock.results[0].value.params).toContain('jest')
  expect(vi.mocked(execa).mock.results[0].value.params).toContain('-u')
  expect(vi.mocked(execa).mock.results[0].value.params).toContain('--debug')
  expect(vi.mocked(execa).mock.results[0].value.params).toContain('--json')
  expect(vi.mocked(execa).mock.results[0].value.params).toContain(
    '--collectCoverage',
  )
})

test('Passes values of other flags to jest', async () => {
  await handler({ ...defaultOptions, bazinga: false, hello: 'world' })

  // Second command because api side runs
  expect(vi.mocked(execa).mock.results[0].value.cmd).toBe('yarn')
  expect(vi.mocked(execa).mock.results[0].value.params).toContain('jest')

  // Note that these below tests aren't the best, since they don't check for order
  // But I'm making sure only 2 extra params get passed
  expect(vi.mocked(execa).mock.results[0].value.params).toEqual(
    expect.arrayContaining(['--bazinga', false]),
  )

  expect(vi.mocked(execa).mock.results[0].value.params).toEqual(
    expect.arrayContaining(['--hello', 'world']),
  )
})
