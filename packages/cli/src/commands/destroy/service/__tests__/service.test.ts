globalThis.__dirname = __dirname

import fs from 'node:fs'
import type * as NodeFS from 'node:fs'

import { vol } from 'memfs'
import { vi, describe, beforeEach, afterEach, test, expect } from 'vitest'

import '../../../../lib/test'

import { getDefaultArgs } from '../../../../lib/index.js'
import type * as LibIndex from '../../../../lib/index.js'
import type * as SchemaHelpers from '../../../../lib/schemaHelpers.js'
import { getDefaultOptions } from '../../../generate/service/service.js'
import { files } from '../../../generate/service/serviceHandler.js'
import { tasks } from '../serviceHandler.js'

vi.mock('node:fs')

vi.mock('../../../../lib', async (importOriginal) => {
  const originalLib = await importOriginal<typeof LibIndex>()
  return {
    ...originalLib,
    generateTemplate: () => '',
  }
})

vi.mock('../../../../lib/schemaHelpers', async (importOriginal) => {
  const originalSchemaHelpers = await importOriginal<typeof SchemaHelpers>()
  const { join } = await import('node:path')
  const { readFileSync } = await vi.importActual<typeof NodeFS>('node:fs')
  return {
    ...originalSchemaHelpers,
    getSchema: () =>
      JSON.parse(
        readFileSync(
          join(import.meta.dirname, 'fixtures', 'post.json'),
          'utf-8',
        ),
      ),
  }
})

describe('rw destroy service', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vol.reset()
    vi.spyOn(fs, 'unlinkSync').mockClear()
    vi.mocked(console.info).mockRestore()
    vi.mocked(console.log).mockRestore()
  })

  describe('for javascript files', () => {
    beforeEach(async () => {
      vol.fromJSON(
        await files({ ...getDefaultArgs(getDefaultOptions()), name: 'User' }),
      )
    })
    test('destroys service files', async () => {
      const unlinkSpy = vi.spyOn(fs, 'unlinkSync')
      const t = tasks({
        componentName: 'service',
        filesFn: files,
        name: 'User',
      })
      t.options.renderer = 'silent'

      return t.run().then(async () => {
        const generatedFiles = Object.keys(
          await files({ ...getDefaultArgs(getDefaultOptions()), name: 'User' }),
        )
        expect(generatedFiles.length).toEqual(unlinkSpy.mock.calls.length)
        generatedFiles.forEach((f) => expect(unlinkSpy).toHaveBeenCalledWith(f))
      })
    })
  })

  describe('for typescript files', () => {
    beforeEach(async () => {
      vol.fromJSON(
        await files({
          ...getDefaultArgs(getDefaultOptions()),
          typescript: true,
          name: 'User',
        }),
      )
    })

    test('destroys service files', async () => {
      const unlinkSpy = vi.spyOn(fs, 'unlinkSync')
      const t = tasks({
        componentName: 'service',
        filesFn: files,
        name: 'User',
      })
      t.options.renderer = 'silent'

      return t.run().then(async () => {
        const generatedFiles = Object.keys(
          await files({
            ...getDefaultArgs(getDefaultOptions()),
            typescript: true,
            name: 'User',
          }),
        )
        expect(generatedFiles.length).toEqual(unlinkSpy.mock.calls.length)
        generatedFiles.forEach((f) => expect(unlinkSpy).toHaveBeenCalledWith(f))
      })
    })
  })
})
