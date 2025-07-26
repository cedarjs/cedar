globalThis.__dirname = __dirname
import '../../lib/test.js'

vi.mock('execa', () => ({
  default: vi.fn((cmd, params) => ({
    cmd,
    params,
  })),
}))

import execa from 'execa'
import { vi, afterEach, test, expect } from 'vitest'

import { handler } from '../test.js'

vi.mock('@cedarjs/structure', () => {
  return {
    getProject: () => ({
      sides: ['web', 'api'],
    }),
  }
})

afterEach(() => {
  vi.clearAllMocks()
})

test('Runs tests for all available sides if no filter passed', async () => {
  await handler({})

  console.log('execa', execa)
  console.log('execa.mock.results', execa.mock.results)

  expect(execa.mock.results[0].value.cmd).toBe('yarn vitest')
  expect(execa.mock.results[0].value.params).toContain('web')
  expect(execa.mock.results[0].value.params).toContain('api')
})

test('Syncs or creates test database when the flag --db-push is set to true', async () => {
  await handler({
    filter: ['api'],
    dbPush: true,
  })

  expect(execa.mock.results[0].value.cmd).toBe('yarn vitest')

  expect(execa.mock.results[0].value.params).toContain('--project', 'api')
})

test('Skips test database sync/creation when the flag --db-push is set to false', async () => {
  await handler({
    filter: ['api'],
    dbPush: false,
  })

  expect(execa.mock.results[0].value.cmd).toBe('yarn vitest')
})

test('Runs tests for all available sides if no side filter passed', async () => {
  await handler({
    filter: ['bazinga'],
  })

  expect(execa.mock.results[0].value.cmd).toBe('yarn vitest')
  expect(execa.mock.results[0].value.params).toContain('bazinga')
  expect(execa.mock.results[0].value.params).toContain('web')
  expect(execa.mock.results[0].value.params).toContain('api')
})

test('Runs tests specified side if even with additional filters', async () => {
  await handler({
    filter: ['web', 'bazinga'],
  })

  expect(execa.mock.results[0].value.cmd).not.toBe('yarn rw')
  expect(execa.mock.results[0].value.params).not.toContain('api')

  expect(execa.mock.results[0].value.cmd).toBe('yarn vitest')
  expect(execa.mock.results[0].value.params).toContain('bazinga')
  expect(execa.mock.results[0].value.params).toContain('web')
})

test('Does not create db when calling test with just web', async () => {
  await handler({
    filter: ['web'],
  })

  expect(execa.mock.results[0].value.cmd).toBe('yarn vitest')
})

test('Passes filter param to vitest command if passed', async () => {
  await handler({
    filter: ['web', 'bazinga'],
  })

  expect(execa.mock.results[0].value.cmd).toBe('yarn vitest')
  expect(execa.mock.results[0].value.params).toContain('bazinga')
})

test('Passes other flags to vitest', async () => {
  await handler({
    u: true,
    debug: true,
    json: true,
    collectCoverage: true,
    watch: true,
  })

  expect(execa.mock.results[0].value.cmd).toBe('yarn vitest')
  expect(execa.mock.results[0].value.params).toContain('-u')
  expect(execa.mock.results[0].value.params).toContain('--debug')
  expect(execa.mock.results[0].value.params).toContain('--json')
  expect(execa.mock.results[0].value.params).toContain('--collectCoverage')
  expect(execa.mock.results[0].value.params).toContain('--watch')
})

test('Passes values of other flags to vitest', async () => {
  await handler({
    bazinga: false,
    hello: 'world',
  })

  // Second command because api side runs
  expect(execa.mock.results[0].value.cmd).toBe('yarn vitest')

  // Note that these below tests aren't the best, since they don't check for order
  // But I'm making sure only 2 extra params get passed
  expect(execa.mock.results[0].value.params).toEqual(
    expect.arrayContaining(['--bazinga', false]),
  )

  expect(execa.mock.results[0].value.params).toEqual(
    expect.arrayContaining(['--hello', 'world']),
  )
})
