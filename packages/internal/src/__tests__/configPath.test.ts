import path from 'path'

import { vi, describe, it, expect, afterAll, beforeAll } from 'vitest'

import { getConfigPath } from '@cedarjs/project-config'

describe('getConfigPath', () => {
  it('throws an error when not in a project', () => {
    expect(getConfigPath).toThrowErrorMatchingInlineSnapshot(
      `[Error: Could not find a "cedar.toml" or "redwood.toml" file, are you sure you're in a Cedar project?]`,
    )
  })

  describe('using CEDAR_CWD environment variable', () => {
    const CEDAR_CWD = process.env.CEDAR_CWD
    const FIXTURE_BASEDIR = path.join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      '__fixtures__',
      'test-project',
    )
    afterAll(() => {
      process.env.CEDAR_CWD = CEDAR_CWD
    })

    it('finds the correct config path when at base directory', () => {
      process.env.CEDAR_CWD = FIXTURE_BASEDIR
      expect(getConfigPath()).toBe(path.join(FIXTURE_BASEDIR, 'cedar.toml'))
    })

    it('finds the correct config path when inside a project directory', () => {
      process.env.CEDAR_CWD = path.join(
        FIXTURE_BASEDIR,
        'web',
        'src',
        'pages',
        'AboutPage',
      )
      expect(getConfigPath()).toBe(path.join(FIXTURE_BASEDIR, 'cedar.toml'))
    })
  })

  describe('using cwd', () => {
    const CEDAR_CWD = process.env.CEDAR_CWD
    const FIXTURE_BASEDIR = path.join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      '__fixtures__',
      'test-project',
    )
    beforeAll(() => {
      delete process.env.CEDAR_CWD
    })
    afterAll(() => {
      process.env.CEDAR_CWD = CEDAR_CWD
      vi.restoreAllMocks()
    })

    it('finds the correct config path when at base directory', () => {
      const spy = vi.spyOn(process, 'cwd')
      spy.mockReturnValue(FIXTURE_BASEDIR)
      expect(getConfigPath()).toBe(path.join(FIXTURE_BASEDIR, 'cedar.toml'))
    })

    it('finds the correct config path when inside a project directory', () => {
      const spy = vi.spyOn(process, 'cwd')
      spy.mockReturnValue(
        path.join(FIXTURE_BASEDIR, 'web', 'src', 'pages', 'AboutPage'),
      )
      expect(getConfigPath()).toBe(path.join(FIXTURE_BASEDIR, 'cedar.toml'))
    })
  })
})
