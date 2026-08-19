globalThis.__dirname = import.meta.dirname

import type * as NodeFs from 'node:fs'
import path from 'node:path'

import { vol, fs as memfs } from 'memfs'
import { ufs } from 'unionfs'
import { vi, test, expect, beforeAll } from 'vitest'

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
import {
  missingRelatedModels,
  writeFilesWithStubsTask,
} from '../../sdl/stubFiles.js'
import { getYargsDefaults } from '../../yargsCommandHelpers.js'
import * as scaffoldHandler from '../scaffoldHandler.js'

beforeAll(() => {
  vol.fromJSON({ 'redwood.toml': '' }, '/')
})

const sdlPath = (fileName: string) =>
  path.normalize(`/path/to/project/api/src/graphql/${fileName}`)
const servicePath = (fileName: string) =>
  path.normalize(`/path/to/project/api/src/services/${fileName}`)
const usersPagePath = () =>
  path.normalize('/path/to/project/web/src/pages/User/UsersPage/UsersPage.jsx')

// This mirrors two successive `cedar generate scaffold` runs: first
// UserProfile (which stubs out User, since User has no SDL yet), then User
// itself once you're ready to flesh it out for real.
test('re-scaffolding a stubbed-out model replaces the stub with the real thing', async () => {
  const upMissing = await missingRelatedModels('UserProfile')
  const upFiles = {
    ...(await scaffoldHandler.files({
      ...getDefaultArgs(getYargsDefaults()),
      docs: false,
      model: 'UserProfile',
      tests: true,
      nestScaffoldByModel: true,
    })),
    ...(await sdlStubFiles(upMissing, 'UserProfile', { typescript: false })),
  }
  await writeFilesWithStubsTask(upFiles).run()

  // Sanity check: User's SDL/service are the read-only stub versions on disk,
  // and no web-side scaffold exists for User yet
  expect(memfs.readFileSync(sdlPath('users.sdl.js'), 'utf-8')).not.toContain(
    'type Mutation',
  )
  expect(
    memfs.readFileSync(servicePath('users/users.js'), 'utf-8'),
  ).not.toContain('createUser')
  expect(memfs.existsSync(usersPagePath())).toEqual(false)

  // Now scaffold User for real
  const userMissing = await missingRelatedModels('User')
  // UserProfile already has SDL from the first scaffold, so nothing is missing
  expect(userMissing).toEqual([])

  const userFiles = {
    ...(await scaffoldHandler.files({
      ...getDefaultArgs(getYargsDefaults()),
      docs: false,
      model: 'User',
      tests: true,
      nestScaffoldByModel: true,
    })),
    ...(await sdlStubFiles(userMissing, 'User', { typescript: false })),
  }

  // No --force needed: the existing SDL/service are pristine stubs, so
  // they're recognized and replaced automatically
  await writeFilesWithStubsTask(userFiles, { overwriteExisting: false }).run()

  const finalSdl = memfs.readFileSync(sdlPath('users.sdl.js'), 'utf-8')
  const finalService = memfs.readFileSync(
    servicePath('users/users.js'),
    'utf-8',
  )

  expect(finalSdl).toContain('type Mutation')
  expect(finalSdl).not.toContain('@cedar-generator-stub-hash')
  expect(finalService).toContain('createUser')
  expect(finalService).toContain('updateUser')
  expect(finalService).toContain('deleteUser')

  // And the full web-side scaffold (layout, pages, cells, forms) now exists
  expect(memfs.existsSync(usersPagePath())).toEqual(true)
})
