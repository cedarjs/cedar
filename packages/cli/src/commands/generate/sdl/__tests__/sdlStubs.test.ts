globalThis.__dirname = import.meta.dirname

import type * as NodeFs from 'node:fs'
import path from 'node:path'

import { vol, fs as memfs } from 'memfs'
import { ufs } from 'unionfs'
import { vi, describe, test, expect, beforeAll, afterEach } from 'vitest'

// Load mocks
import '../../../../lib/test'

vi.mock('node:fs', async (importOriginal) => {
  const { wrapFsForUnionfs, wrapMemfsForUnionfs } =
    await import('../../../../__tests__/ufsFsProxy.js')
  const fs = await importOriginal<typeof NodeFs>()
  ufs.use(wrapFsForUnionfs(fs)).use(wrapMemfsForUnionfs(memfs))

  return { ...ufs, default: ufs }
})

// Have to import fs after memfs is mocked
// eslint-disable-next-line import-x/order
import fs from 'node:fs'

import * as sdlHandler from '../sdlHandler.js'
import {
  addStubHeader,
  isPristineStub,
  missingRelatedModels,
  writeFilesWithStubsTask,
} from '../stubFiles.js'

afterEach(() => {
  vi.clearAllMocks()
  vol.reset()
})

beforeAll(() => {
  vol.fromJSON({ 'redwood.toml': '' }, '/')
})

const sdlPath = (fileName: string) =>
  path.normalize(`/path/to/project/api/src/graphql/${fileName}`)
const servicePath = (fileName: string) =>
  path.normalize(`/path/to/project/api/src/services/${fileName}`)

describe('missingRelatedModels', () => {
  test('finds related models without SDL files', async () => {
    expect(await missingRelatedModels('UserProfile')).toEqual(['User'])
  })

  test('handles circular relations without looping', async () => {
    expect(await missingRelatedModels('User')).toEqual(['UserProfile'])
  })

  test('returns nothing for models without relations', async () => {
    expect(await missingRelatedModels('Post')).toEqual([])
  })

  test('skips related models that already have an SDL file', async () => {
    vol.fromJSON({
      [sdlPath('renamedUsers.sdl.ts')]:
        'export const schema = gql`\n  type User {\n    id: Int!\n  }\n`\n',
    })

    expect(await missingRelatedModels('UserProfile')).toEqual([])
  })

  test('traverses through defined intermediate models to find missing models', async () => {
    // This tests the case where A -> B -> C, B has SDL but C doesn't.
    // We should discover C and generate a stub for it.
    // In the fixture: UserProfile -> User (exists), User -> UserProfile (circular)
    // Both have relations, and we should find missing models through defined ones.
    // Since all related models in the fixture have SDL or are being checked,
    // this is a regression test to ensure the queue.push happens for all models.
    vol.fromJSON({
      [sdlPath('userProfiles.sdl.ts')]:
        'export const schema = gql`\n  type UserProfile {\n    id: Int!\n  }\n`\n',
    })

    // With only UserProfile having SDL, User should be discovered as missing
    expect(await missingRelatedModels('UserProfile')).toContain('User')
  })
})

describe('files with stubs', () => {
  test('generates read-only stubs for missing related models', async () => {
    const files = await sdlHandler.files({
      name: 'UserProfile',
      crud: true,
      tests: true,
      typescript: true,
    })

    // The target model's own files
    expect(files).toHaveProperty([sdlPath('userProfiles.sdl.ts')])
    expect(files).toHaveProperty([servicePath('userProfiles/userProfiles.ts')])

    // The stub files for the related model
    const stubSdl = files[sdlPath('users.sdl.ts')]
    expect(stubSdl).toBeDefined()
    expect(stubSdl).toContain('@cedar-generator-stub-hash')
    // Stubs are read-only
    expect(stubSdl).not.toContain('type Mutation')
    expect(isPristineStub(stubSdl)).toEqual(true)
    expect(stubSdl).toMatchSnapshot()

    const stubService = files[servicePath('users/users.ts')]
    expect(stubService).toBeDefined()
    expect(isPristineStub(stubService)).toEqual(true)

    // Stubs don't get test files
    expect(files).not.toHaveProperty([servicePath('users/users.test.ts')])
    expect(files).not.toHaveProperty([servicePath('users/users.scenarios.ts')])
  })

  test('does not generate stubs when passing an empty stubModels list', async () => {
    const files = await sdlHandler.files({
      name: 'UserProfile',
      crud: true,
      tests: true,
      typescript: true,
      stubModels: [],
    })

    expect(files).not.toHaveProperty([sdlPath('users.sdl.ts')])
  })
})

describe('isPristineStub', () => {
  test('detects unedited and edited stubs', () => {
    const stub = addStubHeader({
      content: 'export const schema = "stub"\n',
      stubModel: 'User',
      generatedFor: 'UserProfile',
    })

    expect(isPristineStub(stub)).toEqual(true)
    // Replace something in the hashed body (not the header, which isn't
    // covered by the hash)
    expect(isPristineStub(stub.replace('"stub"', '"edited"'))).toEqual(false)
    expect(isPristineStub('just a regular file')).toEqual(false)
  })

  test('detects edits to header lines', () => {
    const stub = addStubHeader({
      content: 'export const schema = "stub"\n',
      stubModel: 'User',
      generatedFor: 'UserProfile',
    })

    expect(isPristineStub(stub)).toEqual(true)
    // Edit a header line (the reason comment)
    const edited = stub.replace('UserProfile', 'SomeOtherModel')
    expect(isPristineStub(edited)).toEqual(false)
  })
})

describe('writeFilesWithStubsTask', () => {
  const target = sdlPath('users.sdl.ts')

  test('overwrites pristine stubs without --force', async () => {
    vol.fromJSON({
      [target]: addStubHeader({
        content: 'export const schema = "stub"\n',
        stubModel: 'User',
        generatedFor: 'UserProfile',
      }),
    })

    await writeFilesWithStubsTask({ [target]: 'the real thing' }).run()

    expect(fs.readFileSync(target, 'utf-8')).toEqual('the real thing')
  })

  test('does not overwrite edited stubs without --force', async () => {
    const stub = addStubHeader({
      content: 'export const schema = "stub"\n',
      stubModel: 'User',
      generatedFor: 'UserProfile',
    })
    vol.fromJSON({ [target]: stub.replace('stub"', 'edited"') })

    await expect(
      writeFilesWithStubsTask({ [target]: 'the real thing' }).run(),
    ).rejects.toThrow(/has since been edited/)
  })

  test('does not overwrite regular files without --force', async () => {
    vol.fromJSON({ [target]: 'hand-written sdl' })

    await expect(
      writeFilesWithStubsTask({ [target]: 'the real thing' }).run(),
    ).rejects.toThrow(/already exists/)
  })

  test('overwrites everything with --force', async () => {
    vol.fromJSON({ [target]: 'hand-written sdl' })

    await writeFilesWithStubsTask(
      { [target]: 'the real thing' },
      { overwriteExisting: true },
    ).run()

    expect(fs.readFileSync(target, 'utf-8')).toEqual('the real thing')
  })
})
