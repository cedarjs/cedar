globalThis.__dirname = import.meta.dirname

import type * as NodeFs from 'node:fs'
import path from 'node:path'

import { vol, fs as memfs } from 'memfs'
import { ufs } from 'unionfs'
import { vi, describe, beforeAll, test, expect } from 'vitest'

// Load mocks
import '../../../../lib/test'

import { getDefaultArgs } from '../../../../lib/index.js'
import { getYargsDefaults } from '../../yargsCommandHelpers.js'
import * as scaffoldHandler from '../scaffoldHandler.js'

vi.mock('node:fs', async (importOriginal) => {
  const { wrapFsForUnionfs, wrapMemfsForUnionfs } =
    await import('../../../../__tests__/ufsFsProxy.js')
  ufs
    .use(wrapFsForUnionfs(await importOriginal<typeof NodeFs>()))
    .use(wrapMemfsForUnionfs(memfs))
  return { ...ufs, default: { ...ufs } }
})
vi.mock('execa')

describe('relational form field', () => {
  let form

  beforeAll(async () => {
    vol.fromJSON({ 'redwood.toml': '' }, '/')

    const files = await scaffoldHandler.files({
      ...getDefaultArgs(getYargsDefaults()),
      model: 'Tag',
      tests: true,
      nestScaffoldByModel: true,
    })

    const tagFormPath =
      '/path/to/project/web/src/components/Tag/TagForm/TagForm.jsx'
    form = files[path.normalize(tagFormPath)]
  })

  test("includes optional relational fields with an emptyAs('undefined')", () => {
    expect(form).toMatch("emptyAs={'undefined'}")
  })
})
