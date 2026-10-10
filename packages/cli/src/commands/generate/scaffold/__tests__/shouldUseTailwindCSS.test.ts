globalThis.__dirname = import.meta.dirname

import fs from 'node:fs'

import { vi, describe, expect, test, afterEach } from 'vitest'

import '../../../../lib/test'
import { shouldUseTailwindCSS } from '../scaffoldHandler.js'

vi.mock('node:fs')

const existsSyncSpy = vi.spyOn(fs, 'existsSync')
const readFileSyncSpy = vi.spyOn(fs, 'readFileSync')
afterEach(() => {
  existsSyncSpy.mockReset()
  readFileSyncSpy.mockReset()
})

function mockWebPackageJson(packageJson: Record<string, unknown>) {
  existsSyncSpy.mockImplementation((p) => String(p).endsWith('package.json'))
  readFileSyncSpy.mockReturnValue(JSON.stringify(packageJson))
}

describe('with --tailwind flag not set', () => {
  test('having tailwindcss as a web side devDependency', () => {
    mockWebPackageJson({ devDependencies: { tailwindcss: '^4.3.3' } })

    expect(shouldUseTailwindCSS(undefined)).toEqual(true)
  })

  test('having tailwindcss as a web side dependency', () => {
    mockWebPackageJson({ dependencies: { tailwindcss: '^4.3.3' } })

    expect(shouldUseTailwindCSS(undefined)).toEqual(true)
  })

  test('not having tailwindcss as a web side dependency', () => {
    mockWebPackageJson({ devDependencies: { vite: '^7.0.0' } })

    expect(shouldUseTailwindCSS(undefined)).toEqual(false)
  })

  test('not having a web side package.json', () => {
    existsSyncSpy.mockReturnValue(false)

    expect(shouldUseTailwindCSS(undefined)).toEqual(false)
  })
})

describe('with --tailwind flag set', () => {
  test('having tailwindcss as a web side dependency', () => {
    mockWebPackageJson({ devDependencies: { tailwindcss: '^4.3.3' } })

    expect(shouldUseTailwindCSS(true)).toEqual(true)
    expect(shouldUseTailwindCSS(false)).toEqual(false)
  })

  test('not having tailwindcss as a web side dependency', () => {
    mockWebPackageJson({ devDependencies: { vite: '^7.0.0' } })

    expect(shouldUseTailwindCSS(true)).toEqual(true)
    expect(shouldUseTailwindCSS(false)).toEqual(false)
  })
})
