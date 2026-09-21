globalThis.__dirname = import.meta.dirname

import type * as NodeFs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

import { vol, fs as memfs } from 'memfs'
import { ufs } from 'unionfs'
import { vi, describe, test, expect, afterAll, beforeAll } from 'vitest'

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

const formPath = '/path/to/project/web/src/components/Post/PostForm/PostForm'
const formattersPath = '/path/to/project/web/src/lib/formatters'
const formattersTestPath = '/path/to/project/web/src/lib/formatters.test'

beforeAll(() => {
  vol.fromJSON(
    {
      'redwood.toml': `[graphql.parsedScalars]
  DateTime = "Date"`,
    },
    '/',
  )
})

afterAll(() => {
  vol.reset()
})

describe('with graphql.parsedScalars.DateTime = "Date"', () => {
  let tsFiles: Record<string, string>
  let jsFiles: Record<string, string>

  beforeAll(async () => {
    const args = {
      ...getDefaultArgs(getYargsDefaults()),
      docs: false,
      model: 'Post',
      tests: true,
      nestScaffoldByModel: true,
    }

    tsFiles = await scaffoldHandler.files({ ...args, typescript: true })
    jsFiles = await scaffoldHandler.files({ ...args, typescript: false })
  })

  test('the form takes a Date in formatDatetime', () => {
    const form = tsFiles[path.normalize(`${formPath}.tsx`)]

    expect(form).toContain(
      'function formatDatetime(value: Date | undefined | null) {',
    )
    // The value is used as it is, not parsed from a string
    expect(form).toContain('const date = value')
    expect(form).not.toContain('new Date(value)')
    expect(form).toContain(
      'defaultValue={formatDatetime(props.post?.postedAt)}',
    )
  })

  test('timeTag takes a Date', () => {
    const formatters = tsFiles[path.normalize(`${formattersPath}.tsx`)]

    expect(formatters).toContain(
      'export function timeTag(dateTime: Date | undefined | null) {',
    )
    expect(formatters).toContain('dateTime.toISOString()')
    expect(formatters).toContain('dateTime.toUTCString()')
  })

  test('the timeTag tests pass a Date', () => {
    const formattersTest = tsFiles[path.normalize(`${formattersTestPath}.tsx`)]

    expect(formattersTest).toContain("timeTag(new Date('1970-08-20'))")
    expect(formattersTest).toContain('expect(timeTag(null)).toEqual')
    expect(formattersTest).not.toContain('toUTCString())')
  })

  test('the JavaScript form has the same helper without types', () => {
    const form = jsFiles[path.normalize(`${formPath}.jsx`)]

    expect(form).toContain('function formatDatetime(value) {')
    expect(form).toContain('const date = value')
  })

  test('the generated formatDatetime formats a Date in the local timezone', () => {
    const form = jsFiles[path.normalize(`${formPath}.jsx`)]
    const source = form.match(/function formatDatetime[\s\S]*?\n}\n/)?.[0]

    expect(source).toBeDefined()

    const isFormatDatetime = (
      value: unknown,
    ): value is (value: Date | null | undefined) => string | undefined =>
      typeof value === 'function'
    const generatedFormatter: unknown = vm.runInNewContext(
      `${source}; formatDatetime`,
    )

    if (!isFormatDatetime(generatedFormatter)) {
      throw new Error('The generated form does not define formatDatetime')
    }

    const formatDatetime = generatedFormatter
    const stored = new Date('2026-09-21T14:30:45.123Z')
    const originalTz = process.env.TZ

    try {
      process.env.TZ = 'Europe/Stockholm'

      expect(formatDatetime(stored)).toBe('2026-09-21T16:30')

      process.env.TZ = 'America/New_York'

      expect(formatDatetime(stored)).toBe('2026-09-21T10:30')
      expect(formatDatetime(null)).toBeUndefined()
      expect(formatDatetime(undefined)).toBeUndefined()
      expect(formatDatetime(new Date('not a date'))).toBeUndefined()
    } finally {
      if (originalTz === undefined) {
        delete process.env.TZ
      } else {
        process.env.TZ = originalTz
      }
    }
  })
})
