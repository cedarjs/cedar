import execa from 'execa'
import { vi, describe, it, expect, beforeEach } from 'vitest'

import { findIgnoredPaths, transformGitignore } from '../gitignore.js'

vi.mock('execa', () => ({ default: vi.fn() }))

describe('transformGitignore', () => {
  it('inserts the upload directory entry after dev.db*', () => {
    const source = '.DS_Store\ndev.db*\ndist\n'

    expect(transformGitignore(source)).toBe(
      '.DS_Store\ndev.db*\napi/.uploads\ndist\n',
    )
  })

  it('appends the entry when there is no dev.db* line', () => {
    expect(transformGitignore('.DS_Store\n')).toBe('.DS_Store\napi/.uploads\n')
  })

  it('appends to an empty file', () => {
    expect(transformGitignore('')).toBe('api/.uploads\n')
  })

  it('is a no-op when the entry is already present', () => {
    const source = '.DS_Store\napi/.uploads\ndist\n'

    expect(transformGitignore(source)).toBe(source)
  })

  it('ignores commented-out and indented occurrences of the entry', () => {
    const source = '# api/.uploads\n  api/.uploads\ndist\n'

    expect(transformGitignore(source)).toBe(
      '# api/.uploads\n  api/.uploads\ndist\napi/.uploads\n',
    )
  })
})

describe('findIgnoredPaths', () => {
  beforeEach(() => {
    vi.mocked(execa).mockReset()
  })

  it('returns the paths git check-ignore reports as ignored', async () => {
    vi.mocked(execa).mockResolvedValue({
      stdout: '/project/api/src/services/uploads/uploads.ts',
    } as never)

    const result = await findIgnoredPaths('/project', [
      '/project/api/src/services/uploads/uploads.ts',
    ])

    expect(result).toEqual(['/project/api/src/services/uploads/uploads.ts'])
    expect(execa).toHaveBeenCalledWith(
      'git',
      [
        'check-ignore',
        '/project/api/src/services/uploads/uploads.ts',
      ],
      { cwd: '/project', reject: false },
    )
  })

  it('returns an empty array when nothing is ignored', async () => {
    vi.mocked(execa).mockResolvedValue({ stdout: '' } as never)

    const result = await findIgnoredPaths('/project', [
      '/project/api/src/services/uploads/uploads.ts',
    ])

    expect(result).toEqual([])
  })

  it('returns an empty array without calling execa when there are no paths', async () => {
    const result = await findIgnoredPaths('/project', [])

    expect(result).toEqual([])
    expect(execa).not.toHaveBeenCalled()
  })

  it('returns an empty array when git check-ignore cannot run', async () => {
    vi.mocked(execa).mockRejectedValue(new Error('git is not installed'))

    const result = await findIgnoredPaths('/project', [
      '/project/api/src/services/uploads/uploads.ts',
    ])

    expect(result).toEqual([])
  })
})
