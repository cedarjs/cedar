global.__dirname = __dirname

vi.mock('@cedarjs/project-config', async (importOriginal) => {
  const originalProjectConfig = await importOriginal<typeof ProjectConfig>()
  return {
    ...originalProjectConfig,
    getPaths: () => {
      return {
        generated: {
          base: '.cedar',
        },
      }
    },
  }
})

vi.mock('node:fs')

import fs from 'node:fs'
import path from 'path'

import { vol } from 'memfs'
import { vi, it, expect, beforeEach } from 'vitest'

import type * as ProjectConfig from '@cedarjs/project-config'

import { setLock, unsetLock, isLockSet, clearLocks } from '../locking.js'

beforeEach(() => {
  // Start with no files
  vol.reset()

  // @ts-expect-error - This is assignable in tests
  fs.statSync = vi.fn((lockfilePath) => {
    if (!vol.existsSync(lockfilePath as string)) {
      const error = new Error(
        `ENOENT: no such file or directory, stat '${lockfilePath}'`,
      ) as NodeJS.ErrnoException
      error.code = 'ENOENT'

      throw error
    }

    return {
      birthtimeMs: Date.now(),
    }
  })
})

it('Set a lock', () => {
  setLock('TEST')

  const lockExists = fs.existsSync(path.join('.cedar', 'locks', 'TEST'))
  expect(lockExists).toBe(true)
})

it('Set a lock which is already set', () => {
  setLock('TEST')

  const func = () => setLock('TEST')
  expect(func).toThrow('Lock "TEST" is already set')
})

it('Unset a lock', () => {
  setLock('TEST')
  unsetLock('TEST')

  const lockExists = fs.existsSync(path.join('.cedar', 'locks', 'TEST'))
  expect(lockExists).toBe(false)
})

it('Unset a lock which is not already set', () => {
  unsetLock('TEST')

  const lockExists = fs.existsSync(path.join('.cedar', 'locks', 'TEST'))
  expect(lockExists).toBe(false)
})

it('Detect if lock is set when it is already set', () => {
  setLock('TEST')

  const isSet = isLockSet('TEST')
  expect(isSet).toBe(true)
})

it('Detect if lock is set when it is already unset', () => {
  setLock('TEST')
  unsetLock('TEST')

  const isSet = isLockSet('TEST')
  expect(isSet).toBe(false)
})

it('Detects a stale lock', () => {
  // Fake that the lock is older than 1 hour
  // @ts-expect-error - Partial mock for what's needed in our test
  vi.mocked(fs).statSync.mockImplementation(() => {
    return {
      birthtimeMs: Date.now() - 3600001,
    }
  })
  const spy = vi.spyOn(fs, 'rmSync')

  setLock('TEST')

  const isSet = isLockSet('TEST')
  expect(isSet).toBe(false)
  expect(fs.rmSync).toHaveBeenCalled()

  spy.mockRestore()
})

it('Returns false when statSync throws ENOENT', () => {
  // Simulate a stale `existsSync`/`statSync` race (or a broken symlink, as
  // seen in Vercel's cached builds) where the lockfile disappears between
  // the existence check and the stat call.
  vi.mocked(fs).statSync.mockImplementation(() => {
    const error = new Error('ENOENT') as NodeJS.ErrnoException
    error.code = 'ENOENT'
    throw error
  })

  const isSet = isLockSet('TEST')
  expect(isSet).toBe(false)
})

it('Re-throws non-ENOENT statSync errors', () => {
  vi.mocked(fs).statSync.mockImplementation(() => {
    const error = new Error('EACCES') as NodeJS.ErrnoException
    error.code = 'EACCES'
    throw error
  })

  expect(() => isLockSet('TEST')).toThrow('EACCES')
})

it('Clear a list of locks', () => {
  setLock('TEST-1')
  setLock('TEST-2')
  setLock('TEST-3')
  clearLocks(['TEST-1', 'TEST-3'])

  const isSet1 = isLockSet('TEST-1')
  const isSet2 = isLockSet('TEST-2')
  const isSet3 = isLockSet('TEST-3')
  expect(isSet1).toBe(false)
  expect(isSet2).toBe(true)
  expect(isSet3).toBe(false)
})

it('Clear all locks', () => {
  setLock('TEST-1')
  setLock('TEST-2')
  setLock('TEST-3')
  clearLocks()

  const isSet1 = isLockSet('TEST-1')
  const isSet2 = isLockSet('TEST-2')
  const isSet3 = isLockSet('TEST-3')
  expect(isSet1 || isSet2 || isSet3).toBe(false)
})
