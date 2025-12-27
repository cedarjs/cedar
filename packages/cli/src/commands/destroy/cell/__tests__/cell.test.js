globalThis.__dirname = __dirname

import { vol, fs as memfs } from 'memfs'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'

import '../../../../lib/test'

import { files } from '../../../generate/cell/cellHandler.js'
import { tasks } from '../cellHandler.js'

vi.mock('node:fs', async () => ({ ...memfs, default: memfs }))

vi.mock('../../../../lib', async (importOriginal) => {
  const originalLib = await importOriginal()
  return {
    ...originalLib,
    generateTemplate: () => '',
  }
})

vi.mock('@cedarjs/structure', () => {
  return {
    getProject: () => ({
      cells: [{ queryOperationName: undefined }],
    }),
  }
})

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vol.reset()
  console.info.mockRestore()
  console.log.mockRestore()
})

test('destroys cell files', async () => {
  vol.fromJSON(await files({ name: 'User' }))

  const unlinkSpy = vi.spyOn(memfs, 'unlinkSync')

  const t = tasks({
    componentName: 'cell',
    filesFn: files,
    name: 'User',
  })
  t.options.renderer = 'silent'

  await t.run()

  const generatedFiles = Object.keys(await files({ name: 'User' }))
  expect(generatedFiles.length).toEqual(unlinkSpy.mock.calls.length)
  generatedFiles.forEach((f) => expect(unlinkSpy).toHaveBeenCalledWith(f))
})

test('destroys cell files with stories and tests', async () => {
  vol.fromJSON(await files({ name: 'User', stories: true, tests: true }))
  const unlinkSpy = vi.spyOn(memfs, 'unlinkSync')
  const t = tasks({
    componentName: 'cell',
    filesFn: files,
    name: 'User',
    stories: true,
    tests: true,
  })
  t.options.renderer = 'silent'

  await t.run()

  const generatedFiles = Object.keys(
    await files({ name: 'User', stories: true, tests: true }),
  )
  expect(generatedFiles.length).toEqual(unlinkSpy.mock.calls.length)
  generatedFiles.forEach((f) => expect(unlinkSpy).toHaveBeenCalledWith(f))
})
