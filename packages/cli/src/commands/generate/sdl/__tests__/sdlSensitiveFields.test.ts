globalThis.__dirname = import.meta.dirname

import type * as NodeFs from 'node:fs'
import path from 'node:path'

import ansis from 'ansis'
import { vol, fs as memfs } from 'memfs'
import { ufs } from 'unionfs'
import {
  vi,
  describe,
  test,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
} from 'vitest'

// Load mocks
import '../../../../lib/test'

vi.mock('node:fs', async (importOriginal) => {
  const { wrapFsForUnionfs, wrapMemfsForUnionfs } =
    await import('../../../../__tests__/ufsFsProxy.js')
  const fs = await importOriginal<typeof NodeFs>()
  ufs.use(wrapFsForUnionfs(fs)).use(wrapMemfsForUnionfs(memfs))

  return { ...ufs, default: ufs }
})

import * as sdlHandler from '../sdlHandler.js'

afterEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'log').mockRestore()
  vol.reset()
})

beforeAll(() => {
  vol.fromJSON({ 'cedar.toml': '' }, '/')
})

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

const sdlPath = (fileName: string) =>
  path.normalize(`/path/to/project/api/src/graphql/${fileName}`)
const servicePath = (fileName: string) =>
  path.normalize(`/path/to/project/api/src/services/${fileName}`)

// The Account fixture model mirrors the user model that Cedar's dbAuth setup
// creates, including all of its auth fields
const SENSITIVE_ACCOUNT_FIELDS = [
  'hashedPassword',
  'salt',
  'resetToken',
  'resetTokenExpiresAt',
  'webAuthnChallenge',
]

const accountFiles = async () => {
  return sdlHandler.files({
    name: 'Account',
    crud: true,
    tests: true,
    typescript: true,
  })
}

describe('sensitive fields', () => {
  test('are excluded from the generated SDL', async () => {
    const files = await accountFiles()
    const sdl = files[sdlPath('accounts.sdl.ts')]

    for (const field of SENSITIVE_ACCOUNT_FIELDS) {
      expect(sdl).not.toContain(field)
    }

    // Non-sensitive fields are still there
    expect(sdl).toContain('email')
    expect(sdl).toContain('fullName')

    expect(sdl).toMatchSnapshot()
  })

  test('are excluded from the generated service test', async () => {
    const files = await accountFiles()
    const testFile = files[servicePath('accounts/accounts.test.ts')]

    for (const field of SENSITIVE_ACCOUNT_FIELDS) {
      expect(testFile).not.toContain(field)
    }

    // `hashedPassword` and `salt` are required in the database but excluded
    // from the generated CreateAccountInput, so a create through the
    // generated input type can never succeed — the create test is skipped
    expect(testFile).not.toContain('creates a account')

    // The update test picks a non-sensitive field instead
    expect(testFile).toContain('updates a account')
    expect(testFile).toContain('email')
  })

  test('are kept in the generated scenario, since the database needs them', async () => {
    const files = await accountFiles()
    const scenarioFile = files[servicePath('accounts/accounts.scenarios.ts')]

    expect(scenarioFile).toContain('hashedPassword')
    expect(scenarioFile).toContain('salt')
  })

  test('redactedSensitiveFields lists them per model', async () => {
    expect(await sdlHandler.redactedSensitiveFields(['Account'])).toEqual([
      'Account.hashedPassword',
      'Account.salt',
      'Account.resetToken',
      'Account.resetTokenExpiresAt',
      'Account.webAuthnChallenge',
    ])

    expect(await sdlHandler.redactedSensitiveFields(['Post'])).toEqual([])
  })
})

describe('the redacted-fields note', () => {
  test('is printed when running the command', async () => {
    let output = ''

    await sdlHandler.handler({
      model: 'Account',
      crud: true,
      force: false,
      tests: true,
      typescript: false,
      docs: false,
      rollback: false,
    })

    output = ansis.strip(vi.mocked(console).log.mock.calls.flat().join('\n'))

    for (const field of SENSITIVE_ACCOUNT_FIELDS) {
      expect(output).toContain(`Account.${field}`)
    }

    expect(output).toContain('add them to the SDL file manually')
  })
})

describe('a lone `salt` field', () => {
  test('is kept in the generated SDL', async () => {
    const files = await sdlHandler.files({
      name: 'Recipe',
      crud: true,
      tests: true,
      typescript: true,
    })

    const sdl = files[sdlPath('recipes.sdl.ts')]
    expect(sdl).toContain('salt: String!')

    // The create test is generated as usual, `salt` included
    const testFile = files[servicePath('recipes/recipes.test.ts')]
    expect(testFile).toContain('creates a recipe')
    expect(testFile).toContain('salt')
  })

  test('is not reported as redacted', async () => {
    expect(await sdlHandler.redactedSensitiveFields(['Recipe'])).toEqual([])
  })
})
