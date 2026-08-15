globalThis.__dirname = import.meta.dirname

import type * as NodeFs from 'node:fs'
import path from 'node:path'

import { vol, fs as memfs } from 'memfs'
import { ufs } from 'unionfs'
import { vi, describe, test, expect, beforeAll } from 'vitest'

// Load mocks
import '../../../../lib/test'

vi.mock('node:fs', async (importOriginal) => {
  const { wrapFsForUnionfs, wrapMemfsForUnionfs } =
    await import('../../../../__tests__/ufsFsProxy.js')
  const originalFs = await importOriginal<typeof NodeFs>()
  ufs.use(wrapFsForUnionfs(originalFs)).use(wrapMemfsForUnionfs(memfs))
  return { ...ufs, default: { ...ufs } }
})

vi.mock('execa')

import { getDefaultArgs } from '../../../../lib/index.js'
import { stubFiles as sdlStubFiles } from '../../sdl/sdlHandler.js'
import { isPristineStub, missingRelatedModels } from '../../sdl/stubFiles.js'
import { getYargsDefaults } from '../../yargsCommandHelpers.js'
import * as scaffoldHandler from '../scaffoldHandler.js'

beforeAll(() => {
  vol.fromJSON({ 'redwood.toml': '' }, '/')
})

const sdlPath = (fileName: string) =>
  path.normalize(`/path/to/project/api/src/graphql/${fileName}`)
const servicePath = (fileName: string) =>
  path.normalize(`/path/to/project/api/src/services/${fileName}`)

// This mirrors how `scaffoldHandler.tasks()` combines the two: `files()`
// alone never generates stubs for related models (same contract as the SDL
// generator), so `cedar destroy scaffold` — which calls `files()` directly —
// doesn't delete stub files that other models may still depend on.
describe('scaffolding a model with a relation to a model without SDL', () => {
  let files: Record<string, string>

  beforeAll(async () => {
    // UserProfile has a relation to User, which has no SDL file in the
    // fixture schema
    const missingModels = await missingRelatedModels('UserProfile')

    files = {
      ...(await scaffoldHandler.files({
        ...getDefaultArgs(getYargsDefaults()),
        docs: false,
        model: 'UserProfile',
        tests: true,
        nestScaffoldByModel: true,
      })),
      ...(await sdlStubFiles(missingModels, 'UserProfile', {
        typescript: false,
      })),
    }
  })

  test('generates the scaffold, SDL, and service for the target model', () => {
    expect(files).toHaveProperty([sdlPath('userProfiles.sdl.js')])
    expect(files).toHaveProperty([servicePath('userProfiles/userProfiles.js')])
  })

  test('generates a read-only SDL stub for the missing related model', () => {
    const stubSdl = files[sdlPath('users.sdl.js')]

    expect(stubSdl).toBeDefined()
    expect(stubSdl).toContain('@cedar-generator-stub-hash')
    expect(isPristineStub(stubSdl)).toEqual(true)
  })

  test('generates a read-only service stub for the missing related model', () => {
    const stubService = files[servicePath('users/users.js')]

    expect(stubService).toBeDefined()
    expect(isPristineStub(stubService)).toEqual(true)
  })

  test('does not generate test files for the stub', () => {
    expect(files).not.toHaveProperty([servicePath('users/users.test.js')])
    expect(files).not.toHaveProperty([servicePath('users/users.scenarios.js')])
  })

  test('does not generate web-side scaffold files for the stub model', () => {
    const webFiles = Object.keys(files).filter((filePath) =>
      filePath.includes(path.normalize('/web/')),
    )

    expect(webFiles.every((filePath) => !filePath.includes('User/'))).toEqual(
      true,
    )
  })
})

describe('scaffolding a model with no relations', () => {
  test('finds no missing related models', async () => {
    expect(await missingRelatedModels('CustomIdField')).toEqual([])
  })
})

describe("files() alone never generates stubs (relied on by 'destroy scaffold')", () => {
  test('files() does not include stubs for a model with a missing relation', async () => {
    const files = await scaffoldHandler.files({
      ...getDefaultArgs(getYargsDefaults()),
      docs: false,
      model: 'UserProfile',
      tests: true,
      nestScaffoldByModel: true,
    })

    expect(files).not.toHaveProperty([sdlPath('users.sdl.js')])
    expect(files).not.toHaveProperty([servicePath('users/users.js')])
  })
})
