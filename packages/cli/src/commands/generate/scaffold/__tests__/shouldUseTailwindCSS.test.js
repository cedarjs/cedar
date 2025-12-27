globalThis.__dirname = __dirname

import fs from 'node:fs'

import { vi, describe, expect, test, afterEach } from 'vitest'

import '../../../../lib/test'
import { shouldUseTailwindCSS } from '../scaffoldHandler.js'

vi.mock('node:fs')

let existsSyncSpy = vi.spyOn(fs, 'existsSync')
afterEach(() => {
  existsSyncSpy.mockClear()
})

describe('with --tailwind flag not set', () => {
  test('having a tailwind config file present', () => {
    existsSyncSpy.mockReturnValue(true)

    expect(shouldUseTailwindCSS(undefined)).toEqual(true)
  })

  test('not having a tailwind config file present', () => {
    existsSyncSpy.mockReturnValue(false)

    expect(shouldUseTailwindCSS(undefined)).toEqual(false)
  })
})

describe('with --tailwind flag set', () => {
  test('having a tailwind config file', () => {
    existsSyncSpy.mockReturnValue(true)

    expect(shouldUseTailwindCSS(true)).toEqual(true)
    expect(shouldUseTailwindCSS(false)).toEqual(false)
  })

  test('not having a tailwind config file present', () => {
    existsSyncSpy.mockReturnValue(false)

    expect(shouldUseTailwindCSS(true)).toEqual(true)
    expect(shouldUseTailwindCSS(false)).toEqual(false)
  })
})
