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

vi.mock('@cedarjs/project-config', async (importOriginal) => {
  const originalProjectConfig = await importOriginal<typeof ProjectConfig>()

  return {
    ...originalProjectConfig,
    getPaths: () => {
      return {
        generated: {
          base: '.redwood',
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

describe('Update is not available (1.0.0 -> 1.0.0)', () => {
  beforeAll(async () => {
    const actualProjectConfig = await vi.importActual<typeof ProjectConfig>(
      '@cedarjs/project-config',
    )

    const config = actualProjectConfig.DEFAULT_CONFIG

    // Use fake datetime
    vi.useFakeTimers()
    vi.setSystemTime(new Date(TESTING_CURRENT_DATETIME))
    vi.mocked(getConfig).mockReturnValue({
      ...config,
      notifications: {
        ...config.notifications,
        versionUpdates: ['latest'],
      },
    })

    // Prevent the appearance of stale locks
    // @ts-expect-error - This is assignable in tests
    fs.statSync = vi.fn(() => {
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

  beforeEach(() => {
    // Set the fake remote version
    vi.mocked(latestVersion).mockImplementation(async () => {
      return '1.0.0'
    })

    vol.fromJSON({
      // Users package.json containing the redwood version
      'package.json': JSON.stringify({
        devDependencies: {
          '@cedarjs/core': '^1.0.0',
        },
      }),
    })
  })

  afterEach(() => {
    vol.reset()
    vi.clearAllMocks()
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
    // Use fake datetime
    vi.useFakeTimers()
    vi.setSystemTime(new Date(TESTING_CURRENT_DATETIME))
    // @ts-expect-error - Partial mock return
    vi.mocked(getConfig).mockReturnValue({
      notifications: {
        versionUpdates: ['latest'],
      },
    })

    // Prevent the appearance of stale locks
    // @ts-expect-error - This is assignable in tests
    fs.statSync = vi.fn(() => {
      return {
        birthtimeMs: Date.now(),
      }
    })
  })

  afterAll(() => {
    vi.useRealTimers()
  })

  beforeEach(() => {
    // Set the fake remote version
    vi.mocked(latestVersion).mockImplementation(async () => {
      return '2.0.0'
    })

    vol.fromJSON({
      // Users package.json containing the redwood version
      'package.json': JSON.stringify({
        devDependencies: {
          '@cedarjs/core': '^1.0.0',
        },
      }),
    })
  })

  afterEach(() => {
    vol.reset()
    vi.clearAllMocks()
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

  it('Should want to show after a check has run', async () => {
    await updateCheck.check()
    expect(updateCheck.shouldShow()).toBe(true)
  })

  it('Respects the lock', async () => {
    setLock(updateCheck.CHECK_LOCK_IDENTIFIER)
    expect(updateCheck.shouldCheck()).toBe(false)
  })
})

describe('Update is available with rc tag (1.0.0-rc.1 -> 1.0.1-rc.58)', () => {
  beforeAll(async () => {
    const actualProjectConfig = await vi.importActual<typeof ProjectConfig>(
      '@cedarjs/project-config',
    )

    const config = actualProjectConfig.DEFAULT_CONFIG

    // Use fake datetime
    vi.useFakeTimers()
    vi.setSystemTime(new Date(TESTING_CURRENT_DATETIME))
    vi.mocked(getConfig).mockReturnValue({
      ...config,
      notifications: {
        ...config.notifications,
        versionUpdates: ['latest', 'rc'],
      },
    })

    // Prevent the appearance of stale locks
    // @ts-expect-error - This is assignable in tests
    fs.statSync = vi.fn(() => {
      return {
        birthtimeMs: Date.now(),
      }
    })
  })

  afterAll(() => {
    vi.useRealTimers()
  })

  beforeEach(() => {
    // Set the fake remote version
    vi.mocked(latestVersion).mockImplementation(async (_, options) => {
      return options?.version === 'rc' ? '1.0.1-rc.58' : '1.0.0'
    })

    vol.fromJSON({
      // Users package.json containing the redwood version
      'package.json': JSON.stringify({
        devDependencies: {
          '@cedarjs/core': '^1.0.0-rc.1',
        },
      }),
    })
  })

  afterEach(() => {
    vol.reset()
    vi.clearAllMocks()
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

  it('Should want to show after a check has run', async () => {
    await updateCheck.check()
    expect(updateCheck.shouldShow()).toBe(true)
  })

  it('Respects the lock', async () => {
    setLock(updateCheck.CHECK_LOCK_IDENTIFIER)
    expect(updateCheck.shouldCheck()).toBe(false)
  })
})

describe('Update middleware', () => {
  beforeAll(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(TESTING_CURRENT_DATETIME))
  })

  afterAll(() => {
    vi.useRealTimers()
  })

  beforeEach(() => {
    // Prevent the appearance of stale locks
    // @ts-expect-error - This is assignable in tests
    fs.statSync = vi.fn(() => {
      return {
        birthtimeMs: Date.now(),
      }
    })

    vol.fromJSON({
      '.redwood/updateCheck/data.json': JSON.stringify({
        localVersion: '2.4.1',
        remoteVersions: {
          latest: '2.5.0',
        },
        checkedAt: updateCheck.DEFAULT_DATETIME_MS,
        shownAt: updateCheck.DEFAULT_DATETIME_MS,
      }),
    })
  })

  afterEach(() => {
    vol.reset()
    vi.clearAllMocks()
  })

  it('does not show stale update info when a fresh check is due', () => {
    const processOnSpy = vi.spyOn(process, 'on')

    updateCheck.updateCheckMiddleware({ _: ['info'] })

    expect(spawnBackgroundProcessMock).toHaveBeenCalledTimes(1)
    expect(processOnSpy).not.toHaveBeenCalledWith('exit', expect.any(Function))
  })
})
