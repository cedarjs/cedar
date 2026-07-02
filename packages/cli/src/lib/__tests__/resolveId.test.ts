import path from 'node:path'

import { fs as memfs, vol } from 'memfs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveId } from '../exec.ts'

vi.mock('node:fs', () => ({ ...memfs, default: { ...memfs } }))

beforeEach(() => {
  vol.fromJSON({
    [path.join('api', 'src', 'lib', 'auth.ts')]: 'export const auth = true',
    [path.join('api', 'src', 'events', 'events.ts')]: 'export const foo = 1',
    [path.join('api', 'src', 'integrations', 'buildxact', 'index.ts')]:
      'export const bar = 2',
    [path.join('api', 'src', 'lib', 'accessControl.ts')]:
      'export const baz = 3',
  })
})

afterEach(() => {
  vol.reset()
})

describe('resolveId', () => {
  it('returns the path unchanged when it points to an existing file', () => {
    const id = path.join('api', 'src', 'lib', 'auth.ts')
    expect(resolveId(id)).toBe(id)
  })

  it('resolves a path that points to a directory with an index file', () => {
    const id = path.join('api', 'src', 'integrations', 'buildxact')
    const expected = path.join(
      'api',
      'src',
      'integrations',
      'buildxact',
      'index.ts',
    )
    expect(resolveId(id)).toBe(expected)
  })

  it('resolves a directory path to a directory-named module', () => {
    const id = path.join('api', 'src', 'events')
    const expected = path.join('api', 'src', 'events', 'events.ts')
    expect(resolveId(id)).toBe(expected)
  })

  it('resolves a .js extension to its .ts counterpart', () => {
    const id = path.join('api', 'src', 'lib', 'auth.js')
    const expected = path.join('api', 'src', 'lib', 'auth.ts')
    expect(resolveId(id)).toBe(expected)
  })
})
