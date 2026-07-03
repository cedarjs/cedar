globalThis.__dirname = __dirname

import fs from 'node:fs'
import type * as NodeFS from 'node:fs'

import { vol } from 'memfs'
import { vi, beforeEach, afterEach, test, expect, describe } from 'vitest'

import '../../../../lib/test'

import { getDefaultArgs } from '../../../../lib/index.js'
import type * as LibIndex from '../../../../lib/index.js'
import type * as SchemaHelpers from '../../../../lib/schemaHelpers.js'
import { builder } from '../../../generate/sdl/sdl.js'
import { files } from '../../../generate/sdl/sdlHandler.js'
import { tasks } from '../sdlHandler.js'

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

describe('rw destroy sdl', () => {
  afterEach(() => {
    vol.reset()
    vi.spyOn(fs, 'unlinkSync').mockClear()
  })

  describe('for javascript files', () => {
    beforeEach(async () => {
      vol.fromJSON(await files({ ...getDefaultArgs(builder), name: 'Post' }))
    })

    test('destroys sdl files', async () => {
      const unlinkSpy = vi.spyOn(fs, 'unlinkSync')
      const t = tasks({ model: 'Post' })
      t.options.renderer = 'silent'

      return t.tasks[0].run().then(async () => {
        const generatedFiles = Object.keys(
          await files({ ...getDefaultArgs(builder), name: 'Post' }),
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
          ...getDefaultArgs(builder),
          typescript: true,
          name: 'Post',
        }),
      )
    })

    test('destroys sdl files', async () => {
      const unlinkSpy = vi.spyOn(fs, 'unlinkSync')
      const t = tasks({ model: 'Post' })
      t.options.renderer = 'silent'

      return t.tasks[0].run().then(async () => {
        const generatedFiles = Object.keys(
          await files({
            ...getDefaultArgs(builder),
            typescript: true,
            name: 'Post',
          }),
        )
        expect(generatedFiles.length).toEqual(unlinkSpy.mock.calls.length)
        generatedFiles.forEach((f) => expect(unlinkSpy).toHaveBeenCalledWith(f))
      })
    })
  })
})
