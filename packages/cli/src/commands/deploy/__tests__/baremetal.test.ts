import { Listr } from 'listr2'
import { vi, afterEach, beforeEach, describe, it, expect } from 'vitest'

import type * as ProjectConfigModule from '@cedarjs/project-config'

// Capture __dirname during hoisted mock setup phase
const testDir = vi.hoisted(() => import.meta.dirname)

globalThis.__dirname = testDir

// Track whether handler test should return empty directory
let returnEmptyBasePath = false

vi.mock('@cedarjs/project-config', async (importOriginal) => {
  const originalProjectConfig =
    await importOriginal<typeof ProjectConfigModule>()
  return {
    ...originalProjectConfig,
    getPaths: () => ({
      base: returnEmptyBasePath ? testDir : `${testDir}/fixtures`,
    }),
  }
})

vi.mock('@cedarjs/project-config/packageManager', () => ({
  getPackageManager: vi.fn(() => 'yarn'),
  resetPackageManagerCache: vi.fn(),
}))

import * as baremetal from '../baremetal/baremetalHandler.js'
import type {
  BaremetalYargs,
  LifecycleHooks,
  ServerConfig,
} from '../baremetal/baremetalHandler.js'
import { SshExecutor } from '../baremetal/SshExecutor.js'

const sshExecutor = new SshExecutor(false)

function createServerConfig(
  overrides: Partial<ServerConfig> = {},
): ServerConfig {
  return {
    host: 'host.test',
    port: 22,
    branch: 'main',
    username: 'deploy',
    path: '/var/www/app',
    repo: 'git://github.com',
    packageManagerCommand: 'yarn',
    monitorCommand: 'pm2',
    sides: ['api'],
    keepReleases: 5,
    freeSpaceRequired: 2048,
    ...overrides,
  }
}

function createBaremetalYargs(
  overrides?: Partial<BaremetalYargs>,
): BaremetalYargs {
  return {
    environment: 'production',
    releaseDir: '20220409120000',
    df: true,
    update: true,
    install: true,
    migrate: true,
    build: true,
    restart: true,
    cleanup: true,
    keepAssets: true,
    ...overrides,
  }
}

function createCommandConfig(
  overrides?: Partial<{
    yargs: BaremetalYargs
    ssh: SshExecutor
    serverConfig: ServerConfig
    serverLifecycle: LifecycleHooks
    cmdPath: string
  }>,
) {
  return {
    yargs: createBaremetalYargs(),
    ssh: sshExecutor,
    serverConfig: createServerConfig(),
    serverLifecycle: { before: {}, after: {} },
    cmdPath: '/var/www/app',
    ...overrides,
  }
}

describe('verifyConfig', () => {
  it('throws an error if no environment specified', () => {
    expect(() =>
      baremetal.verifyConfig(
        { production: { servers: [{ host: 'prod.server.com' }] } },
        // @ts-expect-error - testing JS code path
        { releaseDir: '' },
      ),
    ).toThrow('Must specify an environment to deploy to')
  })

  it('throws an error if environment is not found', () => {
    expect(() =>
      baremetal.verifyConfig(
        { production: { servers: [{ host: 'prod.server.com' }] } },
        { environment: 'staging', releaseDir: '' },
      ),
    ).toThrow('No servers found for environment "staging"')
  })
})

describe('verifyServerConfig', () => {
  it('throws an error if host is missing', () => {
    expect(() =>
      baremetal.verifyServerConfig(
        // @ts-expect-error - testing JS consumer path (missing required field)
        { path: '/var/www/app', repo: 'git://github.com' },
      ),
    ).toThrow(
      '"host" config option not set. See https://cedarjs.com/docs/deployment/baremetal#deploytoml',
    )
  })

  it('throws an error if path is missing', () => {
    expect(() =>
      baremetal.verifyServerConfig(
        // @ts-expect-error - testing JS consumer path (missing required field)
        { host: 'host.test', repo: 'git://github.com' },
      ),
    ).toThrow(
      '"path" config option not set. See https://cedarjs.com/docs/deployment/baremetal#deploytoml',
    )
  })

  it('throws an error if repo is missing', () => {
    expect(() =>
      baremetal.verifyServerConfig(
        // @ts-expect-error - testing JS consumer path (missing required field)
        { host: 'host.test', path: '/var/www/app' },
      ),
    ).toThrow(
      '"repo" config option not set. See https://cedarjs.com/docs/deployment/baremetal#deploytoml',
    )
  })

  it('throws an error if freeSpaceRequired is a string of letters', () => {
    expect(() =>
      baremetal.verifyServerConfig(
        createServerConfig({ freeSpaceRequired: 'not a number' }),
      ),
    ).toThrow('"freeSpaceRequired" must be an integer >= 0')
  })

  it('throws an error if freeSpaceRequired is a float (as a string)', () => {
    expect(() =>
      baremetal.verifyServerConfig(
        createServerConfig({ freeSpaceRequired: '100.5' }),
      ),
    ).toThrow('"freeSpaceRequired" must be an integer >= 0')
  })

  it('throws an error if freeSpaceRequired is a float', () => {
    expect(() =>
      baremetal.verifyServerConfig(
        createServerConfig({ freeSpaceRequired: 100.5 }),
      ),
    ).toThrow('"freeSpaceRequired" must be an integer >= 0')
  })

  it('throws an error if freeSpaceRequired includes a unit', () => {
    expect(() =>
      baremetal.verifyServerConfig(
        createServerConfig({ freeSpaceRequired: '3GB' }),
      ),
    ).toThrow('"freeSpaceRequired" must be an integer >= 0')

    expect(() =>
      baremetal.verifyServerConfig(
        createServerConfig({ freeSpaceRequired: '2048 MB' }),
      ),
    ).toThrow('"freeSpaceRequired" must be an integer >= 0')
  })

  it('throws an error if freeSpaceRequired is negative (as a string)', () => {
    expect(() =>
      baremetal.verifyServerConfig(
        createServerConfig({ freeSpaceRequired: '-1' }),
      ),
    ).toThrow('"freeSpaceRequired" must be an integer >= 0')
  })

  it('throws an error if freeSpaceRequired is negative', () => {
    expect(() =>
      baremetal.verifyServerConfig(
        createServerConfig({ freeSpaceRequired: -1 }),
      ),
    ).toThrow('"freeSpaceRequired" must be an integer >= 0')
  })

  it('allows freeSpaceRequired to be 0 (as a string)', () => {
    expect(
      baremetal.verifyServerConfig(
        createServerConfig({ freeSpaceRequired: '0' }),
      ),
    ).toEqual(true)
  })

  it('allows freeSpaceRequired to be 0', () => {
    expect(
      baremetal.verifyServerConfig(
        createServerConfig({ freeSpaceRequired: 0 }),
      ),
    ).toEqual(true)
  })

  it('returns true if no problems', () => {
    expect(
      baremetal.verifyServerConfig(
        createServerConfig({ freeSpaceRequired: 2024 }),
      ),
    ).toEqual(true)
  })
})

describe('maintenanceTasks', () => {
  it('returns tasks to put maintenance page up', () => {
    const tasks = baremetal.maintenanceTasks(
      'up',
      sshExecutor,
      createServerConfig({ processNames: ['api'] }),
    )

    expect(tasks.length).toEqual(2)
    expect(tasks[0].title).toMatch('Enabling')
    expect(tasks[1].title).toMatch('Stopping')
  })

  it('returns tasks to take maintenance page down', () => {
    const tasks = baremetal.maintenanceTasks(
      'down',
      sshExecutor,
      createServerConfig({ processNames: ['api'] }),
    )

    expect(tasks.length).toEqual(2)
    expect(tasks[0].title).toMatch('Starting')
    expect(tasks[1].title).toMatch('Disabling')
  })
})

describe('rollbackTasks', () => {
  it('returns rollback tasks', () => {
    const tasks1 = baremetal.rollbackTasks(
      1,
      sshExecutor,
      createServerConfig({ processNames: ['api'] }),
    )

    expect(tasks1.length).toEqual(2)
    expect(tasks1[0].title).toMatch('Rolling back 1')
    expect(tasks1[1].title).toMatch('Restarting')

    const tasks2 = baremetal.rollbackTasks(
      5,
      sshExecutor,
      createServerConfig({ processNames: ['api'] }),
    )

    expect(tasks2[0].title).toMatch('Rolling back 5')
  })

  it('only rolls back to release directories', async () => {
    const execSpy = vi
      .spyOn(sshExecutor, 'exec')
      .mockImplementation(async (_path, command) => {
        const stdout =
          command === 'readlink'
            ? '/var/www/app/20220409120000'
            : command === 'ls'
              ? 'current\nuploads\n20220409120000\nbackups\n20220408120000\n'
              : ''

        return { stdout, stderr: '', code: 0, signal: null }
      })

    const tasks = baremetal.rollbackTasks(1, sshExecutor, createServerConfig())

    await tasks[0].task()

    expect(execSpy.mock.calls).toEqual([
      ['/var/www/app', 'readlink', ['-f', 'current']],
      ['/var/www/app', 'ls', ['-t']],
      ['/var/www/app', 'ln', ['-nsf', '20220408120000', 'current']],
    ])
  })

  it('does not roll back past the oldest release directory', async () => {
    vi.spyOn(sshExecutor, 'exec').mockImplementation(async (_path, command) => {
      const stdout =
        command === 'readlink'
          ? '/var/www/app/20220409120000'
          : command === 'ls'
            ? 'current\n20220409120000\nuploads\n'
            : ''

      return { stdout, stderr: '', code: 0, signal: null }
    })

    const tasks = baremetal.rollbackTasks(1, sshExecutor, createServerConfig())

    await expect(() => tasks[0].task()).rejects.toThrowError(
      'Cannot rollback 1 release(s): 0 previous release(s) available',
    )
  })

  it('does not roll back when current is not a release directory', async () => {
    const execSpy = vi
      .spyOn(sshExecutor, 'exec')
      .mockImplementation(async (_path, command) => {
        const stdout =
          command === 'readlink'
            ? '/var/www/app/my-release'
            : command === 'ls'
              ? 'current\nmy-release\n20220409120000\n20220408120000\n'
              : ''

        return { stdout, stderr: '', code: 0, signal: null }
      })

    const tasks = baremetal.rollbackTasks(1, sshExecutor, createServerConfig())

    execSpy.mockClear()

    await expect(() => tasks[0].task()).rejects.toThrowError(
      '`current` points to "my-release", which is not a timestamp-named release directory',
    )
    expect(execSpy.mock.calls).toEqual([
      ['/var/www/app', 'readlink', ['-f', 'current']],
      ['/var/www/app', 'ls', ['-t']],
    ])
  })
})

describe('serverConfigWithDefaults', () => {
  it('provides some default settings', () => {
    const config = baremetal.serverConfigWithDefaults(
      {},
      createBaremetalYargs(),
    )
    expect(config).toEqual(baremetal.DEFAULT_SERVER_CONFIG)
  })

  it('allows overriding defaults with custom settings', () => {
    const serverConfig = {
      port: 12345,
      branch: 'venus',
      packageManagerCommand: 'npm',
      monitorCommand: 'god',
      sides: ['native', 'cli'],
      keepReleases: 2,
      freeSpaceRequired: 1000,
    }
    const config = baremetal.serverConfigWithDefaults(
      serverConfig,
      createBaremetalYargs(),
    )
    expect(config).toEqual(serverConfig)
  })

  it('provides default port as 22', () => {
    const config = baremetal.serverConfigWithDefaults(
      {},
      createBaremetalYargs(),
    )
    expect(config.port).toEqual(22)
  })

  it('provides default branch name', () => {
    const config = baremetal.serverConfigWithDefaults(
      {},
      createBaremetalYargs(),
    )
    expect(config.branch).toEqual('main')
  })

  it('overrides branch name from config', () => {
    const config = baremetal.serverConfigWithDefaults(
      { branch: 'earth' },
      createBaremetalYargs(),
    )
    expect(config.branch).toEqual('earth')
  })

  it('overrides branch name from yargs no matter what', () => {
    const config = baremetal.serverConfigWithDefaults(
      { branch: 'earth' },
      createBaremetalYargs({ branch: 'moon' }),
    )
    expect(config.branch).toEqual('moon')
  })

  it('provides default freeSpaceRequired', () => {
    const config = baremetal.serverConfigWithDefaults(
      {},
      createBaremetalYargs(),
    )
    expect(config.freeSpaceRequired).toEqual(2048)
  })
})

describe('parseConfig', () => {
  it('returns the config for an environment', () => {
    const { envConfig } = baremetal.parseConfig(
      createBaremetalYargs(),
      `
        [[production.servers]]
        host = 'server.com'
      `,
    )

    expect(envConfig).toEqual({ servers: [{ host: 'server.com' }] })
  })

  it('returns the proper config from multiple environments', () => {
    const { envConfig } = baremetal.parseConfig(
      createBaremetalYargs({ environment: 'staging' }),
      `
        [[production.servers]]
        host = 'prod.server.com'

        [[staging.servers]]
        host = 'staging.server.com'
      `,
    )

    expect(envConfig).toEqual({ servers: [{ host: 'staging.server.com' }] })
  })

  it('returns empty objects if no lifecycle defined', () => {
    const { envLifecycle } = baremetal.parseConfig(
      createBaremetalYargs(),
      `
        [[production.servers]]
        host = 'server.com'
      `,
    )

    expect(envLifecycle.before).toEqual({})
    expect(envLifecycle.after).toEqual({})
  })

  it('parses a single global lifecycle event', () => {
    const { envLifecycle } = baremetal.parseConfig(
      createBaremetalYargs(),
      `
        [before]
        install = 'yarn global'

        [[production.servers]]
        host = 'server.com'
      `,
    )

    expect(envLifecycle.before).toEqual({ install: ['yarn global'] })
    expect(envLifecycle.after).toEqual({})
  })

  it('parses multiple global lifecycle events', () => {
    const { envLifecycle } = baremetal.parseConfig(
      createBaremetalYargs(),
      `
        [before]
        install = 'yarn global one'
        update = 'yarn global two'

        [[production.servers]]
        host = 'server.com'
      `,
    )

    expect(envLifecycle.before).toEqual({
      install: ['yarn global one'],
      update: ['yarn global two'],
    })
    expect(envLifecycle.after).toEqual({})
  })

  it('parses an array of global lifecycle events', () => {
    const { envLifecycle } = baremetal.parseConfig(
      createBaremetalYargs(),
      `
        [before]
        install = ['yarn global one', 'yarn global two']

        [[production.servers]]
        host = 'server.com'
      `,
    )

    expect(envLifecycle.before).toEqual({
      install: ['yarn global one', 'yarn global two'],
    })
    expect(envLifecycle.after).toEqual({})
  })

  it('parses an env lifecycle event', () => {
    const { envLifecycle } = baremetal.parseConfig(
      createBaremetalYargs(),
      `
        [[production.servers]]
        host = 'server.com'

        [production.before]
        install = 'yarn env'
      `,
    )

    expect(envLifecycle.before).toEqual({ install: ['yarn env'] })
    expect(envLifecycle.after).toEqual({})
  })

  it('parses combined global and env lifecycle events', () => {
    const { envLifecycle } = baremetal.parseConfig(
      createBaremetalYargs(),
      `
        [before]
        install = 'yarn global one'

        [[production.servers]]
        host = 'server.com'

        [production.before]
        install = 'yarn env one'
        update = 'yarn env two'
      `,
    )

    expect(envLifecycle.before).toEqual({
      install: ['yarn global one', 'yarn env one'],
      update: ['yarn env two'],
    })
    expect(envLifecycle.after).toEqual({})
  })

  it('interpolates environment variables correctly', () => {
    process.env.TEST_VAR_HOST = 'staging.server.com'
    process.env.TEST_VAR_REPO = 'git://staging.github.com'
    const {
      envConfig: { servers },
    } = baremetal.parseConfig(
      createBaremetalYargs(),
      `
        [[production.servers]]
        host = '\${TEST_VAR_HOST:server.com}'
        repo = '\${TEST_VAR_REPO:git://github.com}'
        path = '\${TEST_VAR_PATH:/var/www/app}'
        privateKeyPath = '/Users/me/.ssh/id_rsa'
      `,
    )
    const server = (servers as Record<string, string>[])[0]
    expect(server.host).toEqual('staging.server.com')
    expect(server.repo).toEqual('git://staging.github.com')
    // Default value should work
    expect(server.path).toEqual('/var/www/app')
    // No substitution should work
    expect(server.privateKeyPath).toEqual('/Users/me/.ssh/id_rsa')

    delete process.env.TEST_VAR_HOST
    delete process.env.TEST_VAR_REPO
  })
})

describe('commandWithLifecycleEvents', () => {
  it('returns just the command if no lifecycle defined', () => {
    const tasks = baremetal.commandWithLifecycleEvents({
      name: 'update',
      config: createCommandConfig(),
      skip: false,
      command: {
        title: 'Some command',
        task: () => {},
      },
    })

    expect(tasks.length).toEqual(1)
    expect(tasks[0].title).toEqual('Some command')
    expect(tasks[0].skip?.()).toEqual(false)
  })

  it('copies `skip` output into task function', () => {
    const tasks = baremetal.commandWithLifecycleEvents({
      name: 'update',
      config: createCommandConfig(),
      // @ts-expect-error - using a string to make it easier to test an actual
      // copy
      skip: 'foobar',
      command: {
        title: 'Some command',
        task: () => {},
      },
    })

    expect(tasks[0].skip?.()).toEqual('foobar')
  })

  it('includes a `before` lifecycle event', () => {
    const tasks = baremetal.commandWithLifecycleEvents({
      name: 'update',
      config: createCommandConfig({
        serverLifecycle: { before: { update: ['touch'] }, after: {} },
      }),
      skip: false,
      command: {
        title: 'Some command',
        task: () => {},
      },
    })

    expect(tasks.length).toEqual(2)
    expect(tasks[0].title).toEqual('Before update: `touch`')
    expect(tasks[0].skip?.()).toEqual(false)
    expect(tasks[1].title).toEqual('Some command')
    expect(tasks[1].skip?.()).toEqual(false)
  })

  it('includes multiple `before` lifecycle events', () => {
    const tasks = baremetal.commandWithLifecycleEvents({
      name: 'update',
      config: createCommandConfig({
        serverLifecycle: {
          before: { update: ['touch1', 'touch2'] },
          after: {},
        },
      }),
      skip: false,
      command: {
        title: 'Some command',
        task: () => {},
      },
    })

    expect(tasks.length).toEqual(3)
    expect(tasks[0].title).toEqual('Before update: `touch1`')
    expect(tasks[0].skip?.()).toEqual(false)
    expect(tasks[1].title).toEqual('Before update: `touch2`')
    expect(tasks[1].skip?.()).toEqual(false)
    expect(tasks[2].title).toEqual('Some command')
    expect(tasks[2].skip?.()).toEqual(false)
  })

  it('copies `skip` output into `before` lifecycle event task function', () => {
    const tasks = baremetal.commandWithLifecycleEvents({
      name: 'update',
      config: createCommandConfig({
        serverLifecycle: { before: { update: ['touch'] }, after: {} },
      }),
      // @ts-expect-error - using a string to make it easier to test an actual
      // copy
      skip: 'foobar',
      command: {
        title: 'Some command',
        task: () => {},
      },
    })

    expect(tasks[0].skip?.()).toEqual('foobar')
    expect(tasks[1].skip?.()).toEqual('foobar')
  })

  it('includes an `after` lifecycle event', () => {
    const tasks = baremetal.commandWithLifecycleEvents({
      name: 'update',
      config: createCommandConfig({
        serverLifecycle: { before: {}, after: { update: ['touch'] } },
      }),
      skip: false,
      command: {
        title: 'Some command',
        task: () => {},
      },
    })

    expect(tasks.length).toEqual(2)
    expect(tasks[0].title).toEqual('Some command')
    expect(tasks[0].skip?.()).toEqual(false)
    expect(tasks[1].title).toEqual('After update: `touch`')
    expect(tasks[1].skip?.()).toEqual(false)
  })

  it('includes multiple `after` lifecycle events', () => {
    const tasks = baremetal.commandWithLifecycleEvents({
      name: 'update',
      config: createCommandConfig({
        serverLifecycle: {
          before: {},
          after: { update: ['touch1', 'touch2'] },
        },
      }),
      skip: false,
      command: {
        title: 'Some command',
        task: () => {},
      },
    })

    expect(tasks.length).toEqual(3)
    expect(tasks[0].title).toEqual('Some command')
    expect(tasks[0].skip?.()).toEqual(false)
    expect(tasks[1].title).toEqual('After update: `touch1`')
    expect(tasks[1].skip?.()).toEqual(false)
    expect(tasks[2].title).toEqual('After update: `touch2`')
    expect(tasks[2].skip?.()).toEqual(false)
  })

  it('copies `skip` output into `after` lifecycle event task function', () => {
    const tasks = baremetal.commandWithLifecycleEvents({
      name: 'update',
      config: createCommandConfig({
        serverLifecycle: { before: {}, after: { update: ['touch'] } },
      }),
      // @ts-expect-error - using a string to make it easier to test an actual
      // copy
      skip: 'foobar',
      command: {
        title: 'Some command',
        task: () => {},
      },
    })

    expect(tasks[0].skip?.()).toEqual('foobar')
    expect(tasks[1].skip?.()).toEqual('foobar')
  })

  it('includes both `before` and `after` lifecycle events', () => {
    const tasks = baremetal.commandWithLifecycleEvents({
      name: 'update',
      config: createCommandConfig({
        serverLifecycle: {
          before: { update: ['touch1'] },
          after: { update: ['touch2'] },
        },
      }),
      skip: false,
      command: {
        title: 'Some command',
        task: () => {},
      },
    })

    expect(tasks.length).toEqual(3)
    expect(tasks[0].title).toEqual('Before update: `touch1`')
    expect(tasks[0].skip?.()).toEqual(false)
    expect(tasks[1].title).toEqual('Some command')
    expect(tasks[1].skip?.()).toEqual(false)
    expect(tasks[2].title).toEqual('After update: `touch2`')
    expect(tasks[2].skip?.()).toEqual(false)
  })
})

describe('deployTasks', () => {
  const defaultYargs = createBaremetalYargs()
  const defaultServerConfig = createServerConfig({ processNames: ['serve'] })

  const mockTask = {
    skip: vi.fn(),
  }

  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('provides a default list of tasks', () => {
    const tasks = baremetal.deployTasks(
      defaultYargs,
      sshExecutor,
      defaultServerConfig,
      { before: {}, after: {} },
    )

    expect(Object.keys(tasks).length).toEqual(10)
    expect(tasks[0].title).toEqual('Checking available disk space...')
    expect(tasks[0].skip?.()).toEqual(false)
    expect(tasks[1].title).toMatch('Cloning')
    expect(tasks[1].skip?.()).toEqual(false)
    expect(tasks[2].title).toMatch('Symlink .env')
    expect(tasks[2].skip?.()).toEqual(false)
    expect(tasks[3].title).toMatch('Installing')
    expect(tasks[3].skip?.()).toEqual(false)
    expect(tasks[4].title).toMatch('DB Migrations')
    expect(tasks[4].skip?.()).toEqual(false)
    expect(tasks[5].title).toMatch('Building api')
    expect(tasks[5].skip?.()).toEqual(false)
    expect(tasks[6].title).toMatch('Keeping web assets')
    // The web side isn't deployed to this server, so there are no assets to keep
    expect(tasks[6].skip?.()).toEqual(true)
    expect(tasks[7].title).toMatch('Symlinking current')
    expect(tasks[7].skip?.()).toEqual(false)
    expect(tasks[8].title).toMatch('Restarting serve')
    expect(tasks[8].skip?.()).toEqual(false)
    expect(tasks[9].title).toMatch('Cleaning up')
    expect(tasks[9].skip?.()).toEqual(false)
  })

  it('skips the available space check if --no-df is passed', () => {
    const tasks = baremetal.deployTasks(
      { ...defaultYargs, df: false },
      sshExecutor,
      defaultServerConfig,
      { before: {}, after: {} },
    )

    expect(tasks[0].skip?.()).toBeTruthy()
  })

  it('skips the available space check if freeSpaceRequired is set to 0', () => {
    const tasks = baremetal.deployTasks(
      { ...defaultYargs },
      sshExecutor,
      { ...defaultServerConfig, freeSpaceRequired: 0 },
      { before: {}, after: {} },
    )

    expect(tasks[0].skip?.()).toBeTruthy()
  })

  it('throws an error if there is not enough available space on the server and freeSpaceRequired is not configured', async () => {
    vi.spyOn(sshExecutor, 'exec').mockResolvedValue({
      stdout: 'df:1875893',
      stderr: '',
      code: 0,
      signal: null,
    })

    const tasks = baremetal.deployTasks(
      defaultYargs,
      sshExecutor,
      createServerConfig({ sides: ['api', 'web'] }),
      { before: {}, after: {} },
    )

    await expect(() => tasks[0].task({}, {})).rejects.toThrowError(
      /Not enough disk space\. You need at least 2048MB free space to continue\. \(Currently 1832MB available\)/,
    )
  })

  it('throws an error if there is less available space on the server than freeSpaceRequired', async () => {
    vi.spyOn(sshExecutor, 'exec').mockResolvedValue({
      stdout: 'df:3875893',
      stderr: '',
      code: 0,
      signal: null,
    })

    const tasks = baremetal.deployTasks(
      defaultYargs,
      sshExecutor,
      {
        ...defaultServerConfig,
        sides: ['api', 'web'],
        freeSpaceRequired: 4096,
      },
      { before: {}, after: {} },
    )

    await expect(() => tasks[0].task({}, {})).rejects.toThrowError(
      /Not enough disk space\. You need at least 4096MB free space to continue/,
    )
  })

  it("warns if it can't get the available space", async () => {
    vi.spyOn(sshExecutor, 'exec').mockResolvedValue({
      stdout: '',
      stderr: 'df: command not found',
      code: 0,
      signal: null,
    })

    const tasks = baremetal.deployTasks(
      defaultYargs,
      sshExecutor,
      { ...defaultServerConfig, sides: ['api', 'web'] },
      { before: {}, after: {} },
    )

    await tasks[0].task({}, mockTask)

    expect(mockTask.skip).toHaveBeenCalledWith(
      expect.stringContaining('Warning: Could not get disk space information'),
    )
  })

  it("warns if it can't parse the output of the ssh command", async () => {
    vi.spyOn(sshExecutor, 'exec').mockResolvedValue({
      stdout: 'df:/dev/sda1',
      stderr: '',
      code: 0,
      signal: null,
    })

    const tasks = baremetal.deployTasks(
      defaultYargs,
      sshExecutor,
      { ...defaultServerConfig, sides: ['api', 'web'] },
      { before: {}, after: {} },
    )

    await tasks[0].task({}, mockTask)

    expect(mockTask.skip).toHaveBeenCalledWith(
      expect.stringContaining(
        'Warning: Could not parse disk space information',
      ),
    )
  })

  it('builds each side separately', () => {
    const tasks = baremetal.deployTasks(
      defaultYargs,
      sshExecutor,
      { ...defaultServerConfig, sides: ['api', 'web'] },
      { before: {}, after: {} },
    )

    expect(Object.keys(tasks).length).toEqual(11)
    expect(tasks[5].title).toMatch('Building api')
    expect(tasks[6].title).toMatch('Building web')
    expect(tasks[7].title).toMatch('Keeping web assets')
    expect(tasks[7].skip?.()).toEqual(false)
  })

  it('skips migrations if migrate = false in config', () => {
    const tasks = baremetal.deployTasks(
      defaultYargs,
      sshExecutor,
      { ...defaultServerConfig, migrate: false },
      { before: {}, after: {} },
    )

    expect(Object.keys(tasks).length).toEqual(10)
    expect(tasks[4].skip?.()).toEqual(true)
  })

  it('starts pm2 if --first-run flag set', () => {
    const tasks = baremetal.deployTasks(
      { ...defaultYargs, firstRun: true },
      sshExecutor,
      defaultServerConfig,
      { before: {}, after: {} },
    )

    expect(Object.keys(tasks).length).toEqual(11)
    expect(tasks[8].title).toMatch('Starting serve')
    expect(tasks[9].title).toMatch('Saving serve')
  })

  it('skips clone and symlinks if --no-update flag passed', () => {
    const tasks = baremetal.deployTasks(
      { ...defaultYargs, update: false },
      sshExecutor,
      defaultServerConfig,
      { before: {}, after: {} },
    )

    expect(tasks[1].skip?.()).toEqual(true)
    expect(tasks[2].skip?.()).toEqual(true)
    expect(tasks[7].skip?.()).toEqual(true)
  })

  it('skips install if --no-install flag passed', () => {
    const tasks = baremetal.deployTasks(
      { ...defaultYargs, install: false },
      sshExecutor,
      defaultServerConfig,
      { before: {}, after: {} },
    )

    expect(tasks[3].skip?.()).toEqual(true)
  })

  it('skips migrations if --no-migrate flag passed', () => {
    const tasks = baremetal.deployTasks(
      { ...defaultYargs, migrate: false },
      sshExecutor,
      defaultServerConfig,
      { before: {}, after: {} },
    )

    expect(tasks[4].skip?.()).toEqual(true)
  })

  it('skips build if --no-build flag passed', () => {
    const tasks = baremetal.deployTasks(
      { ...defaultYargs, build: false },
      sshExecutor,
      defaultServerConfig,
      { before: {}, after: {} },
    )

    expect(tasks[5].skip?.()).toEqual(true)
  })

  it('skips restart if --no-restart flag passed', () => {
    const tasks = baremetal.deployTasks(
      { ...defaultYargs, restart: false },
      sshExecutor,
      defaultServerConfig,
      { before: {}, after: {} },
    )

    expect(tasks[8].skip?.()).toEqual(true)
  })

  it('skips cleanup if --no-cleanup flag passed', () => {
    const tasks = baremetal.deployTasks(
      { ...defaultYargs, cleanup: false },
      sshExecutor,
      defaultServerConfig,
      { before: {}, after: {} },
    )

    expect(tasks[9].skip?.()).toEqual(true)
  })

  it('skips keeping web assets if --no-keep-assets flag passed', () => {
    const tasks = baremetal.deployTasks(
      { ...defaultYargs, keepAssets: false },
      sshExecutor,
      { ...defaultServerConfig, sides: ['api', 'web'] },
      { before: {}, after: {} },
    )

    expect(tasks[7].title).toMatch('Keeping web assets')
    expect(tasks[7].skip?.()).toEqual(true)
  })

  it('skips keeping web assets if --no-build flag passed', () => {
    const tasks = baremetal.deployTasks(
      { ...defaultYargs, build: false },
      sshExecutor,
      { ...defaultServerConfig, sides: ['api', 'web'] },
      { before: {}, after: {} },
    )

    expect(tasks[7].title).toMatch('Keeping web assets')
    expect(tasks[7].skip?.()).toEqual(true)
  })

  it('skips keeping web assets with a warning if the new release has no build manifest', async () => {
    vi.spyOn(sshExecutor, 'exec').mockRejectedValue(
      new Error('cat: client-build-manifest.json: No such file or directory'),
    )

    const tasks = baremetal.deployTasks(
      defaultYargs,
      sshExecutor,
      { ...defaultServerConfig, sides: ['api', 'web'] },
      { before: {}, after: {} },
    )

    await tasks[7].task({}, mockTask)

    expect(mockTask.skip).toHaveBeenCalledWith(
      expect.stringContaining(
        'No client-build-manifest.json in 20220409120000/web/dist',
      ),
    )
  })

  it('injects lifecycle events for keepAssets', () => {
    const tasks = baremetal.deployTasks(
      defaultYargs,
      sshExecutor,
      defaultServerConfig,
      { before: { keepAssets: ['touch before-keep.txt'] }, after: {} },
    )

    expect(Object.keys(tasks).length).toEqual(11)
    expect(tasks[6].title).toMatch('Before keepAssets: `touch before-keep.txt`')
    expect(tasks[7].title).toMatch('Keeping web assets')
  })

  it('injects lifecycle events for update', () => {
    const tasks = baremetal.deployTasks(
      defaultYargs,
      sshExecutor,
      defaultServerConfig,
      { before: { update: ['touch before-update.txt'] }, after: {} },
    )

    expect(Object.keys(tasks).length).toEqual(11)
    expect(tasks[1].title).toMatch('Before update: `touch before-update.txt`')
    expect(tasks[2].title).toMatch('Cloning')
  })

  it('injects lifecycle events for install', () => {
    const tasks = baremetal.deployTasks(
      defaultYargs,
      sshExecutor,
      defaultServerConfig,
      { before: { install: ['touch before-install.txt'] }, after: {} },
    )

    expect(Object.keys(tasks).length).toEqual(11)
    expect(tasks[3].title).toMatch('Before install: `touch before-install.txt`')
    expect(tasks[4].title).toMatch('Install')
  })

  it('injects lifecycle events for migrate', () => {
    const tasks = baremetal.deployTasks(
      defaultYargs,
      sshExecutor,
      defaultServerConfig,
      { before: { migrate: ['touch before-migrate.txt'] }, after: {} },
    )

    expect(Object.keys(tasks).length).toEqual(11)
    expect(tasks[4].title).toMatch('Before migrate: `touch before-migrate.txt`')
    expect(tasks[5].title).toMatch('DB Migrations')
  })

  it('injects lifecycle events for build', () => {
    const tasks = baremetal.deployTasks(
      defaultYargs,
      sshExecutor,
      defaultServerConfig,
      { before: { build: ['touch before-build.txt'] }, after: {} },
    )

    expect(Object.keys(tasks).length).toEqual(11)
    expect(tasks[5].title).toMatch('Before build: `touch before-build.txt`')
    expect(tasks[6].title).toMatch('Building api')
  })

  it('injects lifecycle events for restart', () => {
    const tasks = baremetal.deployTasks(
      defaultYargs,
      sshExecutor,
      defaultServerConfig,
      { before: { restart: ['touch before-restart.txt'] }, after: {} },
    )

    expect(Object.keys(tasks).length).toEqual(11)
    expect(tasks[8].title).toMatch('Before restart: `touch before-restart.txt`')
    expect(tasks[9].title).toMatch('Restarting')
  })

  it('injects lifecycle events for cleanup', () => {
    const tasks = baremetal.deployTasks(
      defaultYargs,
      sshExecutor,
      defaultServerConfig,
      { before: { cleanup: ['touch before-cleanup.txt'] }, after: {} },
    )

    expect(Object.keys(tasks).length).toEqual(11)
    expect(tasks[9].title).toMatch('Before cleanup: `touch before-cleanup.txt`')
    expect(tasks[10].title).toMatch('Cleaning up')
  })

  it('only deletes release directories when cleaning up old deploys', async () => {
    const execSpy = vi.spyOn(sshExecutor, 'exec').mockResolvedValue({
      stdout: '',
      stderr: '',
      code: 0,
      signal: null,
    })

    const tasks = baremetal.deployTasks(
      defaultYargs,
      sshExecutor,
      createServerConfig({ keepReleases: 3 }),
      { before: {}, after: {} },
    )
    const cleanupTask = tasks.find((task) =>
      task.title.startsWith('Cleaning up'),
    )

    await cleanupTask?.task({}, mockTask)

    expect(execSpy).toHaveBeenCalledExactlyOnceWith(
      '/var/www/app',
      "ls -t | grep -E '^[0-9]{14}$' | tail -n +4 | xargs -r rm -rf",
    )
  })
})

describe('manifestAssetFiles', () => {
  it('lists chunk files with their css and other assets, without duplicates', () => {
    const manifest = JSON.stringify({
      'index.html': {
        file: 'assets/index-C3xKbB2f.js',
        css: ['assets/index-D8a2kQ1x.css'],
        assets: ['assets/logo-B1x2y3z4.png'],
        isEntry: true,
      },
      'src/pages/AboutPage/AboutPage.tsx': {
        file: 'assets/AboutPage-Kq9w8e7r.js',
        assets: ['assets/logo-B1x2y3z4.png'],
      },
      'src/assets/font.woff2': {
        file: 'assets/font-Zx1c2v3b.woff2',
      },
    })

    expect(baremetal.manifestAssetFiles(manifest)).toEqual([
      'assets/index-C3xKbB2f.js',
      'assets/index-D8a2kQ1x.css',
      'assets/logo-B1x2y3z4.png',
      'assets/AboutPage-Kq9w8e7r.js',
      'assets/font-Zx1c2v3b.woff2',
    ])
  })

  it('ignores entries and values that are not shaped like a manifest', () => {
    const manifest = JSON.stringify({
      a: null,
      b: 'not an entry',
      c: { file: 42, css: 'not a list', assets: [1, 'assets/ok-Abc12345.png'] },
    })

    expect(baremetal.manifestAssetFiles(manifest)).toEqual([
      'assets/ok-Abc12345.png',
    ])
    expect(baremetal.manifestAssetFiles('[]')).toEqual([])
    expect(baremetal.manifestAssetFiles('null')).toEqual([])
  })
})

describe('keepPreviousAssets', () => {
  const NEW_RELEASE = '20220409120000'
  const PREVIOUS_RELEASE = '20220408120000'
  const OLDER_RELEASE = '20220407120000'
  const OLDEST_RELEASE = '20220406120000'

  const yargs = createBaremetalYargs({ releaseDir: NEW_RELEASE })
  const serverConfig = createServerConfig({ sides: ['api', 'web'] })
  const warn = vi.fn()

  const sshResponse = (stdout: string) => ({
    stdout,
    stderr: '',
    code: 0,
    signal: null,
  })

  const manifestFor = (...files: string[]) =>
    JSON.stringify(
      Object.fromEntries(files.map((file, i) => [`entry-${i}`, { file }])),
    )

  const defaultManifests: Record<string, string | undefined> = {
    [NEW_RELEASE]: manifestFor(
      'assets/index-New00000.js',
      'assets/AboutPage-Shared00.js',
    ),
    [PREVIOUS_RELEASE]: manifestFor(
      'assets/index-Prev00000.js',
      'assets/AboutPage-Shared00.js',
      'assets/logo-Prev00000.png',
    ),
    [OLDER_RELEASE]: manifestFor(
      'assets/index-Older0000.js',
      'assets/AboutPage-Shared00.js',
    ),
    [OLDEST_RELEASE]: manifestFor('assets/index-Oldest000.js'),
  }

  /**
   * Fakes a server with the four releases above plus the usual non-release
   * entries in the app directory. `cat` returns the release's manifest or
   * fails when the release has none. `failLinksFor` makes `ln` fail for files
   * from that release.
   */
  const mockServer = ({
    manifests = defaultManifests,
    failLinksFor,
  }: {
    manifests?: Record<string, string | undefined>
    failLinksFor?: string
  } = {}) =>
    vi
      .spyOn(sshExecutor, 'exec')
      .mockImplementation(async (path, command, args) => {
        if (command === 'ls') {
          return sshResponse(
            [
              '.env',
              OLDEST_RELEASE,
              OLDER_RELEASE,
              PREVIOUS_RELEASE,
              NEW_RELEASE,
              'current',
              'uploads',
            ].join('\n') + '\n',
          )
        }

        if (command === 'cat') {
          const release = path.match(/\/(\d{14})\/web\/dist$/)?.[1]
          const manifest = release && manifests[release]

          if (!manifest) {
            throw new Error(`cat: ${args?.[0]}: No such file or directory`)
          }

          return sshResponse(manifest)
        }

        if (
          command === 'ln' &&
          failLinksFor &&
          args?.some((arg) => arg.includes(`/${failLinksFor}/`))
        ) {
          throw new Error('ln: failed to create hard link')
        }

        return sshResponse('')
      })

  const linkCalls = (execSpy: ReturnType<typeof mockServer>) =>
    execSpy.mock.calls
      .filter(([, command]) => command === 'ln')
      .map(([, , args]) => args)

  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('links the files of previous releases that the new release does not have', async () => {
    const execSpy = mockServer()

    const linkedCount = await baremetal.keepPreviousAssets(
      yargs,
      sshExecutor,
      serverConfig,
      warn,
    )

    expect(linkedCount).toEqual(4)
    expect(warn).not.toHaveBeenCalled()
    expect(execSpy).toHaveBeenCalledWith(
      `/var/www/app/${NEW_RELEASE}`,
      'mkdir',
      ['-p', `'/var/www/app/${NEW_RELEASE}/web/dist/assets'`],
    )
    expect(linkCalls(execSpy)).toEqual([
      [
        '-f',
        `'/var/www/app/${PREVIOUS_RELEASE}/web/dist/assets/index-Prev00000.js'`,
        `'/var/www/app/${PREVIOUS_RELEASE}/web/dist/assets/logo-Prev00000.png'`,
        `'/var/www/app/${NEW_RELEASE}/web/dist/assets'`,
      ],
      [
        '-f',
        `'/var/www/app/${OLDER_RELEASE}/web/dist/assets/index-Older0000.js'`,
        `'/var/www/app/${NEW_RELEASE}/web/dist/assets'`,
      ],
      [
        '-f',
        `'/var/www/app/${OLDEST_RELEASE}/web/dist/assets/index-Oldest000.js'`,
        `'/var/www/app/${NEW_RELEASE}/web/dist/assets'`,
      ],
    ])
  })

  it('only considers the newest `keepReleases - 1` previous releases', async () => {
    const execSpy = mockServer()

    const linkedCount = await baremetal.keepPreviousAssets(
      yargs,
      sshExecutor,
      { ...serverConfig, keepReleases: 2 },
      warn,
    )

    expect(linkedCount).toEqual(2)
    expect(linkCalls(execSpy)).toHaveLength(1)
    expect(linkCalls(execSpy)[0]?.[1]).toContain(PREVIOUS_RELEASE)
    expect(execSpy).not.toHaveBeenCalledWith(
      `/var/www/app/${OLDER_RELEASE}/web/dist`,
      'cat',
      expect.anything(),
    )
  })

  it('links nothing when only one release is kept', async () => {
    const execSpy = mockServer()

    const linkedCount = await baremetal.keepPreviousAssets(
      yargs,
      sshExecutor,
      { ...serverConfig, keepReleases: 1 },
      warn,
    )

    expect(linkedCount).toEqual(0)
    expect(linkCalls(execSpy)).toHaveLength(0)
  })

  it('returns undefined without listing releases when the new release has no manifest', async () => {
    const execSpy = mockServer({
      manifests: { ...defaultManifests, [NEW_RELEASE]: undefined },
    })

    const linkedCount = await baremetal.keepPreviousAssets(
      yargs,
      sshExecutor,
      serverConfig,
      warn,
    )

    expect(linkedCount).toBeUndefined()
    expect(execSpy).not.toHaveBeenCalledWith('/var/www/app', 'ls')
  })

  it('warns about a previous release without a manifest and keeps going', async () => {
    const execSpy = mockServer({
      manifests: { ...defaultManifests, [PREVIOUS_RELEASE]: undefined },
    })

    const linkedCount = await baremetal.keepPreviousAssets(
      yargs,
      sshExecutor,
      serverConfig,
      warn,
    )

    expect(warn).toHaveBeenCalledExactlyOnceWith(
      `Release ${PREVIOUS_RELEASE} has no web build manifest, skipping its assets`,
    )
    expect(linkedCount).toEqual(2)
    expect(linkCalls(execSpy)[0]?.[1]).toContain(OLDER_RELEASE)
    expect(linkCalls(execSpy)[1]?.[1]).toContain(OLDEST_RELEASE)
  })

  it('warns when linking fails for a release and lets an older release provide the same files', async () => {
    const execSpy = mockServer({
      manifests: {
        ...defaultManifests,
        [PREVIOUS_RELEASE]: manifestFor(
          'assets/index-Prev00000.js',
          'assets/common-Abcdef00.js',
        ),
        [OLDER_RELEASE]: manifestFor('assets/common-Abcdef00.js'),
      },
      failLinksFor: PREVIOUS_RELEASE,
    })

    const linkedCount = await baremetal.keepPreviousAssets(
      yargs,
      sshExecutor,
      serverConfig,
      warn,
    )

    expect(warn).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining(
        `Could not keep the web assets of release ${PREVIOUS_RELEASE}: ` +
          'ln: failed to create hard link',
      ),
    )
    // `common-Abcdef00.js` from the older release plus the oldest release's
    // own file
    expect(linkedCount).toEqual(2)
    expect(linkCalls(execSpy)).toContainEqual([
      '-f',
      `'/var/www/app/${OLDER_RELEASE}/web/dist/assets/common-Abcdef00.js'`,
      `'/var/www/app/${NEW_RELEASE}/web/dist/assets'`,
    ])
  })

  it('links files in batches of 100 per directory', async () => {
    const manyFiles = Array.from(
      { length: 150 },
      (_, i) => `assets/chunk-${String(i).padStart(8, '0')}.js`,
    )
    const execSpy = mockServer({
      manifests: {
        [NEW_RELEASE]: manifestFor('assets/index-New00000.js'),
        [PREVIOUS_RELEASE]: manifestFor(
          ...manyFiles,
          'fonts/font-Abc12345.woff2',
        ),
      },
    })

    const linkedCount = await baremetal.keepPreviousAssets(
      yargs,
      sshExecutor,
      { ...serverConfig, keepReleases: 2 },
      warn,
    )

    expect(linkedCount).toEqual(151)
    expect(execSpy).toHaveBeenCalledWith(
      `/var/www/app/${NEW_RELEASE}`,
      'mkdir',
      ['-p', `'/var/www/app/${NEW_RELEASE}/web/dist/fonts'`],
    )
    const calls = linkCalls(execSpy)
    // `-f`, the sources, and the target directory
    expect(calls.map((args) => args?.length)).toEqual([102, 52, 3])
    expect(calls[2]?.[1]).toContain('fonts/font-Abc12345.woff2')
    expect(calls[2]?.[2]).toEqual(
      `'/var/www/app/${NEW_RELEASE}/web/dist/fonts'`,
    )
  })

  it('quotes paths for the shell', async () => {
    const execSpy = mockServer({
      manifests: {
        [NEW_RELEASE]: manifestFor('assets/index-New00000.js'),
        [PREVIOUS_RELEASE]: manifestFor("assets/it's-Abc12345.png"),
      },
    })

    await baremetal.keepPreviousAssets(
      yargs,
      sshExecutor,
      { ...serverConfig, keepReleases: 2 },
      warn,
    )

    expect(linkCalls(execSpy)[0]?.[1]).toEqual(
      `'/var/www/app/${PREVIOUS_RELEASE}/web/dist/assets/it'\\''s-Abc12345.png'`,
    )
  })
})

describe('RELEASE_DIR_PATTERN', () => {
  const releaseDirRegExp = new RegExp(baremetal.RELEASE_DIR_PATTERN)

  it('matches release directory names', () => {
    expect(releaseDirRegExp.test('20220409120000')).toBe(true)
  })

  it.each(['current', 'uploads', '.env', '2022040912000', '202204091200000'])(
    'does not match %s',
    (name) => {
      expect(releaseDirRegExp.test(name)).toBe(false)
    },
  )
})

describe('commands', () => {
  it('contains a top-level task for each server in an environment', () => {
    const prodServers = baremetal.commands(
      { environment: 'production', releaseDir: '2022051120000' },
      sshExecutor,
    )
    const stagingServers = baremetal.commands(
      { environment: 'staging', releaseDir: '2022051120000' },
      sshExecutor,
    )

    expect(prodServers.length).toEqual(2)
    expect(prodServers[0].title).toEqual('prod1.server.com')
    expect(prodServers[1].title).toEqual('prod2.server.com')

    expect(stagingServers.length).toEqual(1)
    expect(stagingServers[0].title).toEqual('staging.server.com')
  })

  it('a single server contains nested deploy tasks', () => {
    const servers = baremetal.commands(
      { environment: 'staging', releaseDir: '2022051120000' },
      sshExecutor,
    )

    expect(servers[0].task()).toBeInstanceOf(Listr)
  })

  it('contains connection and disconnection tasks', () => {
    const servers = baremetal.commands(
      { environment: 'staging', releaseDir: '2022051120000' },
      sshExecutor,
    )
    const tasks = servers[0].task().tasks

    expect(tasks[0].title).toMatch('Connecting')
    expect(tasks[11].title).toMatch('Disconnecting')
  })

  it('contains deploy tasks by default', () => {
    const servers = baremetal.commands(
      { environment: 'staging', releaseDir: '2022051120000' },
      sshExecutor,
    )
    const tasks = servers[0].task().tasks

    expect(tasks[2].title).toMatch('Cloning')
  })

  it('contains maintenance tasks if yargs are set', () => {
    const servers = baremetal.commands(
      {
        environment: 'staging',
        releaseDir: '2022051120000',
        maintenance: 'up',
      },
      sshExecutor,
    )
    const tasks = servers[0].task().tasks

    expect(tasks.length).toEqual(3)
    expect(tasks[1].title).toMatch('Enabling maintenance')
  })

  it('contains rollback tasks if yargs are set', () => {
    const servers = baremetal.commands(
      {
        environment: 'staging',
        releaseDir: '2022051120000',
        rollback: 2,
      },
      sshExecutor,
    )
    const tasks = servers[0].task().tasks

    expect(tasks.length).toEqual(3)
    expect(tasks[1].title).toMatch('Rolling back 2 release(s)')
  })

  it('includes server-specific lifecycle events', () => {
    const servers = baremetal.commands(
      {
        environment: 'test',
        releaseDir: '2022051120000',
      },
      sshExecutor,
    )
    const tasks = servers[0].task().tasks

    expect(tasks[2].title).toEqual('Before update: `touch update`')
    expect(tasks[6].title).toEqual('After install: `touch install`')
  })
})

describe('handler', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(process, 'exit').mockImplementation((number) => {
      throw new Error('process.exit: ' + number)
    })
  })

  afterEach(() => {
    vi.mocked(console).error.mockRestore?.()
    vi.mocked(process).exit.mockRestore?.()
    returnEmptyBasePath = false
  })

  it("should fail if there's no deploy.toml", async () => {
    // Set flag to make getPaths return testDir (without fixtures and deploy.toml)
    returnEmptyBasePath = true

    // Clear the memoization cache for getPaths since it's cached from previous tests
    const libModule = await import('../../../lib/index.js')
    if (
      'cache' in libModule.getPaths &&
      typeof libModule.getPaths.cache === 'object' &&
      libModule.getPaths.cache &&
      'clear' in libModule.getPaths.cache &&
      typeof libModule.getPaths.cache.clear === 'function'
    ) {
      libModule.getPaths.cache.clear()
    }

    await expect(
      baremetal.handler(createBaremetalYargs()),
    ).rejects.toThrowError('process.exit: 1')
    expect(vi.mocked(console).error).toHaveBeenCalledWith(
      expect.stringContaining('Baremetal deploy has not been properly setup'),
    )
  })
})
