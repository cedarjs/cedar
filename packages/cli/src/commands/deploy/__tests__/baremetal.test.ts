import fs from 'node:fs'

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
    getConfig: () => ({ api: { port: 8911 } }),
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
import { MONITORS, MONITOR_ADAPTERS, isMonitor } from '../baremetal/monitors.js'
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
    monitor: 'pm2',
    monitorCommand: 'pm2',
    sides: ['api'],
    keepReleases: 5,
    freeSpaceRequired: 2048,
    healthCheckTimeout: 30,
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

  it('throws an error if monitor is unknown', () => {
    // Values from deploy.toml aren't typed, so the test feeds a bad one
    const config = createServerConfig({ monitor: 'forever' as 'pm2' })

    expect(() => baremetal.verifyServerConfig(config)).toThrow(
      '"monitor" must be one of "pm2", "systemd-user", "systemd-system"',
    )
  })

  it('returns true if no problems', () => {
    expect(
      baremetal.verifyServerConfig(
        createServerConfig({ freeSpaceRequired: 2024 }),
      ),
    ).toEqual(true)
  })

  it('throws an error if healthCheckUrl is not a URL or false', () => {
    expect(() => {
      baremetal.verifyServerConfig(
        // @ts-expect-error - Testing an invalid value from deploy.toml
        createServerConfig({ healthCheckUrl: true }),
      )
    }).toThrow('"healthCheckUrl" must be an http(s) URL or `false`')
  })

  it('throws an error if healthCheckUrl is not an http(s) URL', () => {
    for (const healthCheckUrl of ['localhost:8911/health', 'ftp://x/health']) {
      expect(() => {
        baremetal.verifyServerConfig(createServerConfig({ healthCheckUrl }))
      }).toThrow('"healthCheckUrl" must be an http(s) URL or `false`')
    }
  })

  it('allows an http(s) healthCheckUrl', () => {
    expect(
      baremetal.verifyServerConfig(
        createServerConfig({ healthCheckUrl: 'https://example.com/health' }),
      ),
    ).toEqual(true)
  })

  it('allows healthCheckUrl to be false', () => {
    expect(
      baremetal.verifyServerConfig(
        createServerConfig({ healthCheckUrl: false }),
      ),
    ).toEqual(true)
  })

  it('throws an error if healthCheckTimeout is not an integer', () => {
    expect(() => {
      baremetal.verifyServerConfig(
        createServerConfig({ healthCheckTimeout: '30s' }),
      )
    }).toThrow('"healthCheckTimeout" must be an integer >= 0')
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

  it('stops and starts processes through the configured monitor', async () => {
    const execSpy = vi.spyOn(sshExecutor, 'exec').mockResolvedValue({
      stdout: '',
      stderr: '',
      code: 0,
      signal: null,
    })
    const serverConfig = createServerConfig({
      monitor: 'systemd-user',
      monitorCommand: 'systemctl --user',
      processNames: ['myapp', 'myapp-jobs@0'],
    })

    const upTasks = baremetal.maintenanceTasks('up', sshExecutor, serverConfig)
    await upTasks[1].task({}, {})
    expect(upTasks[1].title).toEqual('Stopping myapp, myapp-jobs@0...')
    expect(execSpy).toHaveBeenLastCalledWith(
      '/var/www/app',
      'systemctl --user',
      ['stop', 'myapp', 'myapp-jobs@0'],
    )

    const downTasks = baremetal.maintenanceTasks(
      'down',
      sshExecutor,
      serverConfig,
    )
    await downTasks[0].task({}, {})
    expect(downTasks[0].title).toEqual('Starting myapp, myapp-jobs@0...')
    expect(execSpy).toHaveBeenLastCalledWith(
      '/var/www/app',
      'systemctl --user',
      ['start', 'myapp', 'myapp-jobs@0'],
    )
  })
})

describe('rollbackTasks', () => {
  it('returns rollback tasks', () => {
    const tasks1 = baremetal.rollbackTasks(
      1,
      sshExecutor,
      createServerConfig({ processNames: ['api'] }),
    )

    expect(tasks1.length).toEqual(3)
    expect(tasks1[0].title).toMatch('Rolling back 1')
    expect(tasks1[1].title).toMatch('Restarting')
    expect(tasks1[2].title).toEqual(
      'Checking http://localhost:8911/graphql/health...',
    )

    const tasks2 = baremetal.rollbackTasks(
      5,
      sshExecutor,
      createServerConfig({ processNames: ['api'] }),
    )

    expect(tasks2[0].title).toMatch('Rolling back 5')
  })

  it('tells the user how to roll back one more release when the health check fails', async () => {
    const execSpy = vi
      .spyOn(sshExecutor, 'exec')
      .mockRejectedValue(new Error('Connection refused'))

    const tasks = baremetal.rollbackTasks(
      2,
      sshExecutor,
      createServerConfig({ processNames: ['api'], healthCheckTimeout: 0 }),
    )

    await expect(tasks[2].task({}, { output: '' })).rejects.toThrow(
      'The release you rolled back to is live as `current`. Check the ' +
        'process logs on the server, or run the rollback again with ' +
        '`--rollback` to move one more release back.',
    )

    execSpy.mockRestore()
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
    expect(config).toEqual({
      ...baremetal.DEFAULT_SERVER_CONFIG,
      monitorCommand: 'pm2',
    })
  })

  it('allows overriding defaults with custom settings', () => {
    const serverConfig = {
      port: 12345,
      branch: 'venus',
      packageManagerCommand: 'npm',
      monitor: 'systemd-user' as const,
      monitorCommand: 'god',
      sides: ['native', 'cli'],
      keepReleases: 2,
      freeSpaceRequired: 1000,
      healthCheckTimeout: 10,
    }
    const config = baremetal.serverConfigWithDefaults(
      serverConfig,
      createBaremetalYargs(),
    )
    expect(config).toEqual(serverConfig)
  })

  it("uses the monitor's own command when monitorCommand is not set", () => {
    expect(
      baremetal.serverConfigWithDefaults({}, createBaremetalYargs())
        .monitorCommand,
    ).toEqual('pm2')
    expect(
      baremetal.serverConfigWithDefaults(
        { monitor: 'systemd-user' },
        createBaremetalYargs(),
      ).monitorCommand,
    ).toEqual('systemctl --user')
    expect(
      baremetal.serverConfigWithDefaults(
        { monitor: 'systemd-system' },
        createBaremetalYargs(),
      ).monitorCommand,
    ).toEqual('sudo systemctl')
  })

  it('keeps a custom monitorCommand for any monitor', () => {
    const config = baremetal.serverConfigWithDefaults(
      { monitor: 'systemd-system', monitorCommand: 'systemctl' },
      createBaremetalYargs(),
    )

    expect(config.monitor).toEqual('systemd-system')
    expect(config.monitorCommand).toEqual('systemctl')
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

  it('provides default healthCheckTimeout', () => {
    const config = baremetal.serverConfigWithDefaults(
      {},
      createBaremetalYargs(),
    )

    expect(config.healthCheckTimeout).toEqual(30)
    expect(config.healthCheckUrl).toBeUndefined()
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

    expect(Object.keys(tasks).length).toEqual(11)
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
    expect(tasks[9].title).toEqual(
      'Checking http://localhost:8911/graphql/health...',
    )
    expect(tasks[9].skip?.()).toEqual(false)
    expect(tasks[10].title).toMatch('Cleaning up')
    expect(tasks[10].skip?.()).toEqual(false)
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

    expect(Object.keys(tasks).length).toEqual(12)
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

    expect(Object.keys(tasks).length).toEqual(11)
    expect(tasks[4].skip?.()).toEqual(true)
  })

  it('starts pm2 if --first-run flag set', () => {
    const tasks = baremetal.deployTasks(
      { ...defaultYargs, firstRun: true },
      sshExecutor,
      defaultServerConfig,
      { before: {}, after: {} },
    )

    expect(Object.keys(tasks).length).toEqual(13)
    // The check runs before `current` is switched to the new release
    expect(tasks[7].title).toMatch('Checking for ecosystem.config.js')
    expect(tasks[8].title).toMatch('Symlinking current')
    expect(tasks[9].title).toMatch('Starting serve')
    expect(tasks[10].title).toMatch('Saving serve')
  })

  it('fails the first run when the pm2 ecosystem file is missing', async () => {
    const tasks = baremetal.deployTasks(
      { ...defaultYargs, firstRun: true },
      sshExecutor,
      defaultServerConfig,
      { before: {}, after: {} },
    )

    // The test fixtures directory has no ecosystem.config.js
    expect(() => tasks[7].task({}, {})).toThrow(
      'ecosystem.config.js is missing. The pm2 monitor reads it when ' +
        'starting processes for the first time.',
    )
  })

  it('passes the ecosystem file check when the file exists', () => {
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true)

    const tasks = baremetal.deployTasks(
      { ...defaultYargs, firstRun: true },
      sshExecutor,
      defaultServerConfig,
      { before: {}, after: {} },
    )

    expect(() => tasks[7].task({}, {})).not.toThrow()
    expect(existsSpy).toHaveBeenCalledWith(
      expect.stringMatching(/ecosystem\.config\.js$/),
    )
    existsSpy.mockRestore()
  })

  it('enables systemd units on the first run', async () => {
    const execSpy = vi.spyOn(sshExecutor, 'exec').mockResolvedValue({
      stdout: '',
      stderr: '',
      code: 0,
      signal: null,
    })

    const tasks = baremetal.deployTasks(
      { ...defaultYargs, firstRun: true },
      sshExecutor,
      {
        ...defaultServerConfig,
        monitor: 'systemd-user',
        monitorCommand: 'systemctl --user',
        processNames: ['myapp', 'myapp-jobs@0'],
      },
      { before: {}, after: {} },
    )

    expect(tasks.map((task) => task.title).slice(8, 11)).toEqual([
      'Reloading systemd unit files...',
      'Enabling and starting myapp for the first time...',
      'Enabling and starting myapp-jobs@0 for the first time...',
    ])
    expect(tasks[11].title).toMatch('Checking http://')

    await tasks[8].task({}, {})
    await tasks[9].task({}, {})
    expect(execSpy.mock.calls).toEqual([
      ['/var/www/app', 'systemctl --user', ['daemon-reload']],
      ['/var/www/app', 'systemctl --user', ['enable', '--now', 'myapp']],
    ])
  })

  it('restarts systemd units with the configured command', async () => {
    const execSpy = vi.spyOn(sshExecutor, 'exec').mockResolvedValue({
      stdout: '',
      stderr: '',
      code: 0,
      signal: null,
    })

    const tasks = baremetal.deployTasks(
      defaultYargs,
      sshExecutor,
      {
        ...defaultServerConfig,
        monitor: 'systemd-system',
        monitorCommand: 'sudo systemctl',
        processNames: ['myapp'],
      },
      { before: {}, after: {} },
    )

    expect(tasks[8].title).toEqual('Restarting myapp...')
    await tasks[8].task({}, {})
    expect(execSpy).toHaveBeenCalledWith('/var/www/app', 'sudo systemctl', [
      'restart',
      'myapp',
    ])
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

  it('skips restart and the health check if --no-restart flag passed', () => {
    const tasks = baremetal.deployTasks(
      { ...defaultYargs, restart: false },
      sshExecutor,
      defaultServerConfig,
      { before: {}, after: {} },
    )

    expect(tasks[8].skip?.()).toEqual(true)
    expect(tasks[9].skip?.()).toEqual(true)
  })

  it('skips the health check if healthCheckUrl is false in config', () => {
    const tasks = baremetal.deployTasks(
      defaultYargs,
      sshExecutor,
      { ...defaultServerConfig, healthCheckUrl: false },
      { before: {}, after: {} },
    )

    expect(tasks[9].title).toEqual('Checking health...')
    expect(tasks[9].skip?.()).toEqual(true)
  })

  it('skips the health check on servers without the api side', () => {
    const tasks = baremetal.deployTasks(
      defaultYargs,
      sshExecutor,
      { ...defaultServerConfig, sides: ['web'] },
      { before: {}, after: {} },
    )

    expect(tasks[9].skip?.()).toEqual(true)
  })

  it('checks a configured healthCheckUrl', () => {
    const tasks = baremetal.deployTasks(
      defaultYargs,
      sshExecutor,
      {
        ...defaultServerConfig,
        sides: ['web'],
        healthCheckUrl: 'http://localhost:8910/',
      },
      { before: {}, after: {} },
    )

    expect(tasks[9].title).toEqual('Checking http://localhost:8910/...')
    expect(tasks[9].skip?.()).toEqual(false)
  })

  it('runs the health check after the first start too', () => {
    const tasks = baremetal.deployTasks(
      { ...defaultYargs, firstRun: true },
      sshExecutor,
      defaultServerConfig,
      { before: {}, after: {} },
    )

    expect(tasks[9].title).toMatch('Starting serve process for the first time')
    expect(tasks[10].title).toMatch('Saving serve state')
    expect(tasks[11].title).toEqual(
      'Checking http://localhost:8911/graphql/health...',
    )
    expect(tasks[11].skip?.()).toEqual(false)
  })

  it('runs the health check once after all processes are restarted', () => {
    const tasks = baremetal.deployTasks(
      defaultYargs,
      sshExecutor,
      { ...defaultServerConfig, processNames: ['api', 'web'] },
      { before: {}, after: {} },
    )

    expect(tasks[8].title).toMatch('Restarting api')
    expect(tasks[9].title).toMatch('Restarting web')
    expect(tasks[10].title).toMatch('Checking http://')
    expect(tasks[11].title).toMatch('Cleaning up')
  })

  it('fails the deploy when the health check does not pass', async () => {
    vi.spyOn(sshExecutor, 'exec').mockRejectedValue(
      new Error('curl: (7) Failed to connect to localhost port 8911'),
    )

    const tasks = baremetal.deployTasks(
      defaultYargs,
      sshExecutor,
      { ...defaultServerConfig, healthCheckTimeout: 0 },
      { before: {}, after: {} },
    )

    await expect(tasks[9].task({}, { output: '' })).rejects.toThrow(
      'Health check failed: http://localhost:8911/graphql/health did not ' +
        'respond successfully within 0 seconds of restarting the serve ' +
        'process(es).\n' +
        'Last attempt: curl: (7) Failed to connect to localhost port 8911\n\n' +
        'The new release is live as `current`. Check the process logs on ' +
        'the server, or roll back to the previous release with `yarn cedar ' +
        'deploy baremetal production --rollback`.\n' +
        'If your app serves its health check somewhere else, set ' +
        '`healthCheckUrl` in deploy.toml. Set it to `false` to skip the ' +
        'check. See https://cedarjs.com/docs/deploy/baremetal#health-check',
    )
  })

  it('skips cleanup if --no-cleanup flag passed', () => {
    const tasks = baremetal.deployTasks(
      { ...defaultYargs, cleanup: false },
      sshExecutor,
      defaultServerConfig,
      { before: {}, after: {} },
    )

    expect(tasks[10].skip?.()).toEqual(true)
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

  it('reports linked files and warnings as task output', async () => {
    const releaseDir = '20220409120000'
    const previous = '20220408120000'
    vi.spyOn(sshExecutor, 'exec').mockImplementation(async (path, command) => {
      const ok = (stdout: string) => ({
        stdout,
        stderr: '',
        code: 0,
        signal: null,
      })

      if (command === 'ls') {
        return ok(`20220407120000\n${previous}\n${releaseDir}\n`)
      }

      if (command === 'cat') {
        if (path.includes(releaseDir)) {
          return ok(JSON.stringify({ a: { file: 'assets/new-Aaaaaaaa.js' } }))
        }

        if (path.includes(previous)) {
          return ok(JSON.stringify({ a: { file: 'assets/old-Bbbbbbbb.js' } }))
        }

        throw new Error('cat: client-build-manifest.json: No such file')
      }

      return ok('')
    })
    const task = { output: '', skip: vi.fn() }

    const tasks = baremetal.deployTasks(
      defaultYargs,
      sshExecutor,
      { ...defaultServerConfig, sides: ['api', 'web'] },
      { before: {}, after: {} },
    )

    await tasks[7].task({}, task)

    expect(task.skip).not.toHaveBeenCalled()
    expect(task.output).toMatch(/^Linked 1 file\(s\) from previous releases\n/)
    expect(task.output).toMatch(
      'Release 20220407120000 has no web build manifest, skipping its assets',
    )
  })

  it('injects lifecycle events for keepAssets', () => {
    const tasks = baremetal.deployTasks(
      defaultYargs,
      sshExecutor,
      defaultServerConfig,
      { before: { keepAssets: ['touch before-keep.txt'] }, after: {} },
    )

    expect(Object.keys(tasks).length).toEqual(12)
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

    expect(Object.keys(tasks).length).toEqual(12)
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

    expect(Object.keys(tasks).length).toEqual(12)
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

    expect(Object.keys(tasks).length).toEqual(12)
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

    expect(Object.keys(tasks).length).toEqual(12)
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

    expect(Object.keys(tasks).length).toEqual(12)
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

    expect(Object.keys(tasks).length).toEqual(12)
    expect(tasks[10].title).toMatch(
      'Before cleanup: `touch before-cleanup.txt`',
    )
    expect(tasks[11].title).toMatch('Cleaning up')
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

describe('healthCheckUrl', () => {
  it('defaults to the graphql health endpoint on the api port', () => {
    expect(baremetal.healthCheckUrl(createServerConfig())).toEqual(
      'http://localhost:8911/graphql/health',
    )
    expect(
      baremetal.healthCheckUrl(createServerConfig({ sides: ['api', 'web'] })),
    ).toEqual('http://localhost:8911/graphql/health')
  })

  it('has nothing to check on a server without the api side', () => {
    expect(
      baremetal.healthCheckUrl(createServerConfig({ sides: ['web'] })),
    ).toBeUndefined()
  })

  it('uses a configured url on any server', () => {
    expect(
      baremetal.healthCheckUrl(
        createServerConfig({
          sides: ['web'],
          healthCheckUrl: 'http://localhost:8910/',
        }),
      ),
    ).toEqual('http://localhost:8910/')
  })

  it('is disabled with false', () => {
    expect(
      baremetal.healthCheckUrl(createServerConfig({ healthCheckUrl: false })),
    ).toBeUndefined()
  })
})

describe('waitForHealthCheck', () => {
  const url = 'http://localhost:8911/graphql/health'
  const ok = { stdout: '', stderr: '', code: 0, signal: null }

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('requests the url on the server with curl', async () => {
    const execSpy = vi.spyOn(sshExecutor, 'exec').mockResolvedValue(ok)

    await baremetal.waitForHealthCheck({
      url: "http://localhost:8911/it's-healthy",
      timeoutSeconds: 30,
      ssh: sshExecutor,
      serverConfig: createServerConfig(),
      nextSteps: [],
    })

    expect(execSpy).toHaveBeenCalledExactlyOnceWith('/var/www/app', 'curl', [
      '--fail',
      '--location',
      '--silent',
      '--show-error',
      '--output',
      '/dev/null',
      '--max-time',
      '5',
      "'http://localhost:8911/it'\\''s-healthy'",
    ])
  })

  it('retries until the url responds', async () => {
    const onFailedAttempt = vi.fn()
    const execSpy = vi
      .spyOn(sshExecutor, 'exec')
      .mockRejectedValueOnce(new Error('Connection refused'))
      .mockRejectedValueOnce(new Error('HTTP 503'))
      .mockResolvedValue(ok)

    const promise = baremetal.waitForHealthCheck({
      url,
      timeoutSeconds: 30,
      ssh: sshExecutor,
      serverConfig: createServerConfig(),
      nextSteps: [],
      onFailedAttempt,
    })

    await vi.advanceTimersByTimeAsync(4000)
    await expect(promise).resolves.toBeUndefined()

    expect(execSpy).toHaveBeenCalledTimes(3)
    expect(onFailedAttempt.mock.calls).toEqual([
      ['Connection refused'],
      ['HTTP 503'],
    ])
  })

  it('gives up when the timeout passes', async () => {
    const execSpy = vi
      .spyOn(sshExecutor, 'exec')
      .mockRejectedValue(new Error('Connection refused'))

    const promise = baremetal.waitForHealthCheck({
      url,
      timeoutSeconds: 5,
      ssh: sshExecutor,
      serverConfig: createServerConfig({ processNames: ['api', 'web'] }),
      nextSteps: ['Do this next.'],
    })
    // Prevents an unhandled rejection while the timers are advanced
    const result = promise.catch((e: unknown) => e)

    await vi.advanceTimersByTimeAsync(10_000)

    const error = await result
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toEqual(
      'Health check failed: http://localhost:8911/graphql/health did not ' +
        'respond successfully within 5 seconds of restarting the api, web ' +
        'process(es).\n' +
        'Last attempt: Connection refused\n\n' +
        'Do this next.\n' +
        'If your app serves its health check somewhere else, set ' +
        '`healthCheckUrl` in deploy.toml. Set it to `false` to skip the ' +
        'check. See https://cedarjs.com/docs/deploy/baremetal#health-check',
    )
    // Attempts at 0s, 2s and 4s. The next retry would be after the deadline
    expect(execSpy).toHaveBeenCalledTimes(3)
  })

  it('makes a single attempt when the timeout is 0', async () => {
    const execSpy = vi
      .spyOn(sshExecutor, 'exec')
      .mockRejectedValue(new Error('Connection refused'))

    await expect(
      baremetal.waitForHealthCheck({
        url,
        timeoutSeconds: 0,
        ssh: sshExecutor,
        serverConfig: createServerConfig(),
        nextSteps: [],
      }),
    ).rejects.toThrow('Health check failed')

    expect(execSpy).toHaveBeenCalledTimes(1)
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
   * entries in the app directory. `cat` returns the release's manifest from
   * `distDir` or fails when the release has none. `failLinksFor` makes `ln`
   * fail for files from that release.
   */
  const mockServer = ({
    manifests = defaultManifests,
    distDir = 'web/dist',
    failLinksFor,
  }: {
    manifests?: Record<string, string | undefined>
    distDir?: string
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
          const release = path.match(new RegExp(`/(\\d{14})/${distDir}$`))?.[1]
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

    const result = await baremetal.keepPreviousAssets(
      yargs,
      sshExecutor,
      serverConfig,
    )

    expect(result).toEqual({ status: 'done', linkedCount: 4, warnings: [] })
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

    const result = await baremetal.keepPreviousAssets(yargs, sshExecutor, {
      ...serverConfig,
      keepReleases: 2,
    })

    expect(result).toEqual({ status: 'done', linkedCount: 2, warnings: [] })
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

    const result = await baremetal.keepPreviousAssets(yargs, sshExecutor, {
      ...serverConfig,
      keepReleases: 1,
    })

    expect(result).toEqual({ status: 'done', linkedCount: 0, warnings: [] })
    expect(linkCalls(execSpy)).toHaveLength(0)
  })

  it('is skipped without listing releases when the new release has no manifest', async () => {
    const execSpy = mockServer({
      manifests: { ...defaultManifests, [NEW_RELEASE]: undefined },
    })

    const result = await baremetal.keepPreviousAssets(
      yargs,
      sshExecutor,
      serverConfig,
    )

    expect(result).toEqual({
      status: 'skipped',
      reason:
        `No client-build-manifest.json in ${NEW_RELEASE}/web/dist or ` +
        `${NEW_RELEASE}/web/dist/browser`,
    })
    expect(execSpy).not.toHaveBeenCalledWith('/var/www/app', 'ls')
  })

  it('is skipped with the parse error when the new release has a corrupt manifest', async () => {
    mockServer({
      manifests: { ...defaultManifests, [NEW_RELEASE]: '{ not json' },
    })

    const result = await baremetal.keepPreviousAssets(
      yargs,
      sshExecutor,
      serverConfig,
    )

    expect(result).toMatchObject({ status: 'skipped' })
    expect(result.status === 'skipped' && result.reason).toMatch(
      `Could not parse /var/www/app/${NEW_RELEASE}/web/dist/client-build-manifest.json: `,
    )
  })

  it('reads the manifest from web/dist/browser for streaming SSR and RSC builds', async () => {
    const execSpy = mockServer({ distDir: 'web/dist/browser' })

    const result = await baremetal.keepPreviousAssets(yargs, sshExecutor, {
      ...serverConfig,
      keepReleases: 2,
    })

    expect(result).toEqual({ status: 'done', linkedCount: 2, warnings: [] })
    expect(linkCalls(execSpy)).toEqual([
      [
        '-f',
        `'/var/www/app/${PREVIOUS_RELEASE}/web/dist/browser/assets/index-Prev00000.js'`,
        `'/var/www/app/${PREVIOUS_RELEASE}/web/dist/browser/assets/logo-Prev00000.png'`,
        `'/var/www/app/${NEW_RELEASE}/web/dist/browser/assets'`,
      ],
    ])
  })

  it('ignores shell output printed before the manifest', async () => {
    mockServer({
      manifests: Object.fromEntries(
        Object.entries(defaultManifests).map(([release, manifest]) => [
          release,
          `Non-interactive shell detected\n${manifest}`,
        ]),
      ),
    })

    const result = await baremetal.keepPreviousAssets(
      yargs,
      sshExecutor,
      serverConfig,
    )

    expect(result).toEqual({ status: 'done', linkedCount: 4, warnings: [] })
  })

  it('warns about a previous release without a manifest and keeps going', async () => {
    const execSpy = mockServer({
      manifests: { ...defaultManifests, [PREVIOUS_RELEASE]: undefined },
    })

    const result = await baremetal.keepPreviousAssets(
      yargs,
      sshExecutor,
      serverConfig,
    )

    expect(result).toEqual({
      status: 'done',
      linkedCount: 2,
      warnings: [
        `Release ${PREVIOUS_RELEASE} has no web build manifest, skipping its assets`,
      ],
    })
    expect(linkCalls(execSpy)[0]?.[1]).toContain(OLDER_RELEASE)
    expect(linkCalls(execSpy)[1]?.[1]).toContain(OLDEST_RELEASE)
  })

  it('warns about a previous release with a corrupt manifest and keeps going', async () => {
    mockServer({
      manifests: { ...defaultManifests, [PREVIOUS_RELEASE]: 'not json' },
    })

    const result = await baremetal.keepPreviousAssets(
      yargs,
      sshExecutor,
      serverConfig,
    )

    expect(result).toMatchObject({ status: 'done', linkedCount: 2 })
    expect(result.status === 'done' && result.warnings).toHaveLength(1)
    expect(result.status === 'done' && result.warnings[0]).toMatch(
      `Skipping the web assets of release ${PREVIOUS_RELEASE}: Could not parse ` +
        `/var/www/app/${PREVIOUS_RELEASE}/web/dist/client-build-manifest.json: `,
    )
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

    const result = await baremetal.keepPreviousAssets(
      yargs,
      sshExecutor,
      serverConfig,
    )

    // `common-Abcdef00.js` from the older release plus the oldest release's
    // own file
    expect(result).toEqual({
      status: 'done',
      linkedCount: 2,
      warnings: [
        `Could not keep the web assets of release ${PREVIOUS_RELEASE}: ` +
          'ln: failed to create hard link',
      ],
    })
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

    const result = await baremetal.keepPreviousAssets(yargs, sshExecutor, {
      ...serverConfig,
      keepReleases: 2,
    })

    expect(result).toEqual({ status: 'done', linkedCount: 151, warnings: [] })
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

    await baremetal.keepPreviousAssets(yargs, sshExecutor, {
      ...serverConfig,
      keepReleases: 2,
    })

    expect(linkCalls(execSpy)[0]?.[1]).toEqual(
      `'/var/www/app/${PREVIOUS_RELEASE}/web/dist/assets/it'\\''s-Abc12345.png'`,
    )
  })
})

describe('monitor adapters', () => {
  it('lists the supported monitors', () => {
    expect(MONITORS).toEqual(['pm2', 'systemd-user', 'systemd-system'])
    expect(isMonitor('pm2')).toBe(true)
    expect(isMonitor('systemd-user')).toBe(true)
    expect(isMonitor('forever')).toBe(false)
    expect(isMonitor(undefined)).toBe(false)
  })

  it('pm2 starts from the ecosystem file and saves the process list on first run', () => {
    const pm2 = MONITOR_ADAPTERS.pm2

    expect(pm2.defaultCommand).toEqual('pm2')
    expect(pm2.firstRunConfigFile).toEqual('ecosystem.config.js')
    expect(pm2.firstRunSetup).toEqual([])
    expect(pm2.firstRun('serve').map((command) => command.args)).toEqual([
      ['start', 'current/ecosystem.config.js', '--only', 'serve'],
      ['save'],
    ])
    expect(pm2.restart('serve').args).toEqual(['restart', 'serve'])
    expect(pm2.stop(['api', 'web']).args).toEqual(['stop', 'api', 'web'])
    expect(pm2.start(['api', 'web']).args).toEqual(['start', 'api', 'web'])
  })

  it('systemd reloads units once and enables each unit on first run', () => {
    for (const monitor of ['systemd-user', 'systemd-system'] as const) {
      const adapter = MONITOR_ADAPTERS[monitor]

      expect(adapter.firstRunConfigFile).toBeUndefined()
      expect(adapter.firstRunSetup.map((command) => command.args)).toEqual([
        ['daemon-reload'],
      ])
      expect(adapter.firstRun('myapp').map((command) => command.args)).toEqual([
        ['enable', '--now', 'myapp'],
      ])
      expect(adapter.restart('myapp').args).toEqual(['restart', 'myapp'])
      expect(adapter.stop(['myapp', 'myapp-jobs@0']).args).toEqual([
        'stop',
        'myapp',
        'myapp-jobs@0',
      ])
      expect(adapter.start(['myapp']).args).toEqual(['start', 'myapp'])
    }

    expect(MONITOR_ADAPTERS['systemd-user'].defaultCommand).toEqual(
      'systemctl --user',
    )
    expect(MONITOR_ADAPTERS['systemd-system'].defaultCommand).toEqual(
      'sudo systemctl',
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
