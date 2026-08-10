globalThis.__dirname = import.meta.dirname

import type * as NodeFs from 'node:fs'

import { vol, fs as memfs } from 'memfs'
import { ufs } from 'unionfs'
import { vi, describe, test, expect, beforeAll } from 'vitest'

// Load mocks
import '../../../../lib/test'

import { getDefaultArgs } from '../../../../lib/index.js'
import { getYargsDefaults } from '../../yargsCommandHelpers.js'
import * as scaffoldHandler from '../scaffoldHandler.js'

vi.mock('node:fs', async (importOriginal) => {
  const { wrapFsForUnionfs, wrapMemfsForUnionfs } =
    await import('../../../../__tests__/ufsFsProxy.js')
  const originalFs = await importOriginal<typeof NodeFs>()
  ufs.use(wrapFsForUnionfs(originalFs)).use(wrapMemfsForUnionfs(memfs))
  return { ...ufs, default: { ...ufs } }
})

vi.mock('execa')

beforeAll(() => {
  vol.fromJSON({ 'redwood.toml': '' }, '/')
})

// The Account fixture model mirrors the user model that Cedar's dbAuth setup
// creates, including all of its auth fields
const SENSITIVE_ACCOUNT_FIELDS = [
  'hashedPassword',
  'salt',
  'resetToken',
  'resetTokenExpiresAt',
  'webAuthnChallenge',
]

describe('scaffolding a model with sensitive fields', () => {
  let files: Record<string, string>

  beforeAll(async () => {
    files = await scaffoldHandler.files({
      ...getDefaultArgs(getYargsDefaults()),
      docs: false,
      model: 'Account',
      tests: true,
      nestScaffoldByModel: true,
    })
  })

  test('excludes sensitive fields from every web-side file', () => {
    const webFiles = Object.entries(files).filter(([filePath]) =>
      filePath.includes('/web/'),
    )

    expect(webFiles.length).toBeGreaterThan(0)

    for (const [filePath, content] of webFiles) {
      for (const field of SENSITIVE_ACCOUNT_FIELDS) {
        expect(content, filePath).not.toContain(field)
      }
    }
  })

  test('excludes sensitive fields from the generated SDL', () => {
    const [sdlPath, sdl] =
      Object.entries(files).find(([filePath]) =>
        filePath.endsWith('accounts.sdl.js'),
      ) ?? []

    expect(sdlPath).toBeDefined()

    for (const field of SENSITIVE_ACCOUNT_FIELDS) {
      expect(sdl).not.toContain(field)
    }
  })

  test('still renders non-sensitive fields in the form', () => {
    const [formPath, form] =
      Object.entries(files).find(([filePath]) =>
        filePath.endsWith('AccountForm/AccountForm.jsx'),
      ) ?? []

    expect(formPath).toBeDefined()
    expect(form).toContain('email')
    expect(form).toContain('fullName')
  })
})
