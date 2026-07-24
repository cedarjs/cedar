global.__dirname = __dirname

const { spawnBackgroundProcessMock } = vi.hoisted(() => {
  return {
    spawnBackgroundProcessMock: vi.fn(),
  }
})

vi.mock('node:fs')
vi.mock('latest-version')
vi.mock('../background.js', () => {
  return {
    spawnBackgroundProcess: spawnBackgroundProcessMock,
  }
})

vi.mock('@cedarjs/project-config/packageManager', () => ({
  getPackageManager: vi.fn(() => 'yarn'),
  resetPackageManagerCache: vi.fn(),
}))

vi.mock('@cedarjs/project-config', async (importOriginal) => {
  const originalProjectConfig = await importOriginal<typeof ProjectConfig>()

  return {
    ...originalProjectConfig,
    getPaths: () => {
      return {
        generated: {
          base: '.cedar',
        },
        base: '',
      }
    },
    getConfig: vi.fn(),
  }
})

import fs from 'node:fs'

import latestVersion from 'latest-version'
import { vol } from 'memfs'
import {
  vi,
  describe,
  beforeAll,
  afterAll,
  it,
  expect,
  beforeEach,
  afterEach,
} from 'vitest'

import { getConfig } from '@cedarjs/project-config'
import type * as ProjectConfig from '@cedarjs/project-config'

import { setLock } from '../locking.js'
import * as updateCheck from '../updateCheck.js'

const TESTING_CURRENT_DATETIME = 1640995200000

function setVersionUpdates(tags: string[]) {
  // @ts-expect-error - A partial config is enough for these tests
  vi.mocked(getConfig).mockReturnValue({
    notifications: {
      versionUpdates: tags,
    },
  })
}

beforeAll(() => {
  // Use fake datetime
  vi.useFakeTimers()
  vi.setSystemTime(new Date(TESTING_CURRENT_DATETIME))

  // Prevent the appearance of stale locks. Throw ENOENT when the underlying
  // memfs filesystem doesn't have the path so `isLockSet` can distinguish
  // a missing lock from a fresh one.
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

  // Prevent console output during tests
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'time').mockImplementation(() => {})
  vi.spyOn(console, 'timeEnd').mockImplementation(() => {})
})

afterAll(() => {
  vi.useRealTimers()
})

afterEach(() => {
  vol.reset()
  vi.clearAllMocks()
})

describe('Update is not available (1.0.0 -> 1.0.0)', () => {
  beforeAll(() => {
    setVersionUpdates(['latest'])
  })

  beforeEach(() => {
    // Set the fake remote version
    vi.mocked(latestVersion).mockImplementation(async () => {
      return '1.0.0'
    })

    vol.fromJSON({
      // The user's package.json containing the pinned Cedar version
      'package.json': JSON.stringify({
        devDependencies: {
          '@cedarjs/core': '1.0.0',
        },
      }),
    })
  })

  it('Produces the correct updateData.json file', async () => {
    await updateCheck.check()
    const data = updateCheck.readUpdateDataFile()
    const remoteVersionsObj = Object.fromEntries(data.remoteVersions)
    expect({ ...data, remoteVersions: remoteVersionsObj }).toStrictEqual({
      localVersion: '1.0.0',
      remoteVersions: { latest: '1.0.0' },
      checkedAt: TESTING_CURRENT_DATETIME,
      shownAt: updateCheck.DEFAULT_DATETIME_MS,
    })
  })

  it('Should want to check before any check has run', () => {
    expect(updateCheck.shouldCheck()).toBe(true)
  })

  it('Should not want to check after a check has run', async () => {
    await updateCheck.check()
    expect(updateCheck.shouldCheck()).toBe(false)
  })

  it('Should not want to show before any check has run', () => {
    expect(updateCheck.shouldShow()).toBe(false)
  })

  it('Should not want to show after a check has run', async () => {
    await updateCheck.check()
    expect(updateCheck.shouldShow()).toBe(false)
  })

  it('Respects the lock', async () => {
    setLock(updateCheck.CHECK_LOCK_IDENTIFIER)
    expect(updateCheck.shouldCheck()).toBe(false)
  })
})

describe('Update is available (1.0.0 -> 2.0.0)', () => {
  beforeAll(() => {
    setVersionUpdates(['latest'])
  })

  beforeEach(() => {
    // Set the fake remote version
    vi.mocked(latestVersion).mockImplementation(async () => {
      return '2.0.0'
    })

    vol.fromJSON({
      // The user's package.json containing the pinned Cedar version
      'package.json': JSON.stringify({
        devDependencies: {
          '@cedarjs/core': '1.0.0',
        },
      }),
    })
  })

  it('Produces the correct updateData.json file', async () => {
    await updateCheck.check()
    const data = updateCheck.readUpdateDataFile()
    const remoteVersionsObj = Object.fromEntries(data.remoteVersions)
    expect({ ...data, remoteVersions: remoteVersionsObj }).toStrictEqual({
      localVersion: '1.0.0',
      remoteVersions: { latest: '2.0.0' },
      checkedAt: TESTING_CURRENT_DATETIME,
      shownAt: updateCheck.DEFAULT_DATETIME_MS,
    })
  })

  it('Should not want to check after a check has run', async () => {
    await updateCheck.check()
    expect(updateCheck.shouldCheck()).toBe(false)
  })

  it('Should not want to show before any check has run', () => {
    expect(updateCheck.shouldShow()).toBe(false)
  })

  it('Should want to show after a check has run', async () => {
    await updateCheck.check()
    expect(updateCheck.shouldShow()).toBe(true)
  })
})

describe('Update is available with rc tag (1.0.0-rc.1 -> 1.0.1-rc.58)', () => {
  beforeAll(() => {
    setVersionUpdates(['latest', 'rc'])
  })

  beforeEach(() => {
    // Set the fake remote version
    vi.mocked(latestVersion).mockImplementation(async (_, options) => {
      return options?.version === 'rc' ? '1.0.1-rc.58' : '1.0.0'
    })

    vol.fromJSON({
      // The user's package.json containing the pinned Cedar version
      'package.json': JSON.stringify({
        devDependencies: {
          '@cedarjs/core': '1.0.0-rc.1',
        },
      }),
    })
  })

  it('Produces the correct updateData.json file', async () => {
    await updateCheck.check()
    const data = updateCheck.readUpdateDataFile()
    const remoteVersionsObj = Object.fromEntries(data.remoteVersions)
    expect({ ...data, remoteVersions: remoteVersionsObj }).toStrictEqual({
      localVersion: '1.0.0-rc.1',
      remoteVersions: { latest: '1.0.0', rc: '1.0.1-rc.58' },
      checkedAt: TESTING_CURRENT_DATETIME,
      shownAt: updateCheck.DEFAULT_DATETIME_MS,
    })
  })

  it('Should want to show after a check has run', async () => {
    await updateCheck.check()
    expect(updateCheck.shouldShow()).toBe(true)
  })
})

describe('Update middleware', () => {
  beforeAll(() => {
    setVersionUpdates(['latest'])
  })

  beforeEach(() => {
    vol.fromJSON({
      'package.json': JSON.stringify({
        devDependencies: {
          '@cedarjs/core': '2.4.1',
        },
      }),
      '.cedar/updateCheck/data.json': JSON.stringify({
        localVersion: '2.4.1',
        remoteVersions: {
          latest: '2.5.0',
        },
        checkedAt: updateCheck.DEFAULT_DATETIME_MS,
        shownAt: updateCheck.DEFAULT_DATETIME_MS,
      }),
    })
  })

  it('does not show stale update info when a fresh check is due', () => {
    const processOnSpy = vi.spyOn(process, 'on')

    updateCheck.updateCheckMiddleware({ _: ['info'] })

    expect(spawnBackgroundProcessMock).toHaveBeenCalledTimes(1)
    expect(processOnSpy).not.toHaveBeenCalledWith('exit', expect.any(Function))
  })
})

describe('@cedarjs/core version is not pinned', () => {
  beforeAll(() => {
    setVersionUpdates(['latest'])
  })

  beforeEach(() => {
    vi.mocked(latestVersion).mockImplementation(async () => {
      return '2.0.0'
    })
  })

  it.each([
    'file:/some/path/tarballs/cedarjs-core.tgz',
    'workspace:*',
    '^1.0.0',
  ])('Skips the check and clears stored versions for %s', async (spec) => {
    vol.fromJSON({
      'package.json': JSON.stringify({
        devDependencies: {
          '@cedarjs/core': spec,
        },
      }),
      // Stale data from before the project switched to a non-pinned spec
      '.cedar/updateCheck/data.json': JSON.stringify({
        localVersion: '1.0.0',
        remoteVersions: { latest: '2.0.0' },
        checkedAt: updateCheck.DEFAULT_DATETIME_MS,
        shownAt: updateCheck.DEFAULT_DATETIME_MS,
      }),
    })

    await updateCheck.check()

    expect(latestVersion).not.toHaveBeenCalled()

    const data = updateCheck.readUpdateDataFile()
    expect(data.localVersion).toBe('0.0.0')
    expect(data.remoteVersions.size).toBe(0)
    expect(data.checkedAt).toBe(TESTING_CURRENT_DATETIME)

    // The recorded check prevents re-running on every command, and the
    // cleared versions prevent showing the stale notification
    expect(updateCheck.shouldCheck()).toBe(false)
    expect(updateCheck.shouldShow()).toBe(false)
  })
})

describe('Project version changed while the cached data is still fresh', () => {
  beforeAll(() => {
    setVersionUpdates(['latest'])
  })

  it('Forces a fresh check and does not show a stale notification', () => {
    // The cache says the project is on 1.0.0 with a 2.0.0 update available,
    // but the project has since been upgraded to 2.0.0 itself
    vol.fromJSON({
      'package.json': JSON.stringify({
        devDependencies: {
          '@cedarjs/core': '2.0.0',
        },
      }),
      '.cedar/updateCheck/data.json': JSON.stringify({
        localVersion: '1.0.0',
        remoteVersions: { latest: '2.0.0' },
        checkedAt: TESTING_CURRENT_DATETIME,
        shownAt: updateCheck.DEFAULT_DATETIME_MS,
      }),
    })

    expect(updateCheck.shouldCheck()).toBe(true)
    expect(updateCheck.shouldShow()).toBe(false)
  })
})
