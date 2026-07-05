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

<<<<<<< HEAD
import * as baremetalHandler from '../baremetal/baremetalHandler.js'
=======
vi.mock('@cedarjs/project-config/packageManager', () => ({
  getPackageManager: vi.fn(() => 'yarn'),
  resetPackageManagerCache: vi.fn(),
}))

import * as baremetal from '../baremetal/baremetalHandler.js'
<<<<<<< HEAD:packages/cli/src/commands/deploy/__tests__/baremetal.test.js
>>>>>>> 7982d76ba7 (feat(pm): Package manager agnostic deploy commands (#1925))
=======
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
>>>>>>> 33ed75844c (chore(cli): migrate test files from JS to TypeScript (batch 3) (#2040)):packages/cli/src/commands/deploy/__tests__/baremetal.test.ts

describe('verifyConfig', () => {
  it('throws an error if no environment specified', () => {
    expect(() =>
      baremetalHandler.verifyConfig(
        { production: { servers: [{ host: 'prod.server.com' }] } },
        // @ts-expect-error - testing JS code path
        { releaseDir: '' },
      ),
    ).toThrow('Must specify an environment to deploy to')
  })

  it('throws an error if environment is not found', () => {
    expect(() =>
      baremetalHandler.verifyConfig(
        { production: { servers: [{ host: 'prod.server.com' }] } },
        { environment: 'staging', releaseDir: '' },
      ),
    ).toThrow('No servers found for environment "staging"')
  })
})

describe('verifyServerConfig', () => {
  it('throws an error if host is missing', () => {
    expect(() =>
<<<<<<< HEAD:packages/cli/src/commands/deploy/__tests__/baremetal.test.js
      baremetalHandler.verifyServerConfig({
        path: '/var/www/app',
        repo: 'git://github.com',
      }),
=======
      baremetal.verifyServerConfig(
        // @ts-expect-error - testing JS consumer path (missing required field)
        { path: '/var/www/app', repo: 'git://github.com' },
      ),
>>>>>>> 33ed75844c (chore(cli): migrate test files from JS to TypeScript (batch 3) (#2040)):packages/cli/src/commands/deploy/__tests__/baremetal.test.ts
    ).toThrow(
      '"host" config option not set. See https://cedarjs.com/docs/deployment/baremetal#deploytoml',
    )
  })

  it('throws an error if path is missing', () => {
    expect(() =>
<<<<<<< HEAD:packages/cli/src/commands/deploy/__tests__/baremetal.test.js
      baremetalHandler.verifyServerConfig({
        host: 'host.test',
        repo: 'git://github.com',
      }),
=======
      baremetal.verifyServerConfig(
        // @ts-expect-error - testing JS consumer path (missing required field)
        { host: 'host.test', repo: 'git://github.com' },
      ),
>>>>>>> 33ed75844c (chore(cli): migrate test files from JS to TypeScript (batch 3) (#2040)):packages/cli/src/commands/deploy/__tests__/baremetal.test.ts
    ).toThrow(
      '"path" config option not set. See https://cedarjs.com/docs/deployment/baremetal#deploytoml',
    )
  })

  it('throws an error if repo is missing', () => {
    expect(() =>
<<<<<<< HEAD:packages/cli/src/commands/deploy/__tests__/baremetal.test.js
      baremetalHandler.verifyServerConfig({
        host: 'host.test',
        path: '/var/www/app',
      }),
=======
      baremetal.verifyServerConfig(
        // @ts-expect-error - testing JS consumer path (missing required field)
        { host: 'host.test', path: '/var/www/app' },
      ),
>>>>>>> 33ed75844c (chore(cli): migrate test files from JS to TypeScript (batch 3) (#2040)):packages/cli/src/commands/deploy/__tests__/baremetal.test.ts
    ).toThrow(
      '"repo" config option not set. See https://cedarjs.com/docs/deployment/baremetal#deploytoml',
    )
  })

  it('throws an error if freeSpaceRequired is a string of letters', () => {
    expect(() =>
<<<<<<< HEAD:packages/cli/src/commands/deploy/__tests__/baremetal.test.js
      baremetalHandler.verifyServerConfig({
        host: 'host.test',
        path: '/var/www/app',
        repo: 'git://github.com',
        freeSpaceRequired: 'not a number',
      }),
=======
      baremetal.verifyServerConfig(
        createServerConfig({ freeSpaceRequired: 'not a number' }),
      ),
>>>>>>> 33ed75844c (chore(cli): migrate test files from JS to TypeScript (batch 3) (#2040)):packages/cli/src/commands/deploy/__tests__/baremetal.test.ts
    ).toThrow('"freeSpaceRequired" must be an integer >= 0')
  })

  it('throws an error if freeSpaceRequired is a float (as a string)', () => {
    expect(() =>
<<<<<<< HEAD:packages/cli/src/commands/deploy/__tests__/baremetal.test.js
      baremetalHandler.verifyServerConfig({
        host: 'host.test',
        path: '/var/www/app',
        repo: 'git://github.com',
        freeSpaceRequired: '100.5',
      }),
=======
      baremetal.verifyServerConfig(
        createServerConfig({ freeSpaceRequired: '100.5' }),
      ),
>>>>>>> 33ed75844c (chore(cli): migrate test files from JS to TypeScript (batch 3) (#2040)):packages/cli/src/commands/deploy/__tests__/baremetal.test.ts
    ).toThrow('"freeSpaceRequired" must be an integer >= 0')
  })

  it('throws an error if freeSpaceRequired is a float', () => {
    expect(() =>
<<<<<<< HEAD:packages/cli/src/commands/deploy/__tests__/baremetal.test.js
      baremetalHandler.verifyServerConfig({
        host: 'host.test',
        path: '/var/www/app',
        repo: 'git://github.com',
        freeSpaceRequired: 100.5,
      }),
=======
      baremetal.verifyServerConfig(
        createServerConfig({ freeSpaceRequired: 100.5 }),
      ),
>>>>>>> 33ed75844c (chore(cli): migrate test files from JS to TypeScript (batch 3) (#2040)):packages/cli/src/commands/deploy/__tests__/baremetal.test.ts
    ).toThrow('"freeSpaceRequired" must be an integer >= 0')
  })

  it('throws an error if freeSpaceRequired includes a unit', () => {
    expect(() =>
<<<<<<< HEAD:packages/cli/src/commands/deploy/__tests__/baremetal.test.js
      baremetalHandler.verifyServerConfig({
        host: 'host.test',
        path: '/var/www/app',
        repo: 'git://github.com',
        freeSpaceRequired: '3GB',
      }),
    ).toThrow('"freeSpaceRequired" must be an integer >= 0')

    expect(() =>
      baremetalHandler.verifyServerConfig({
        host: 'host.test',
        path: '/var/www/app',
        repo: 'git://github.com',
        freeSpaceRequired: '2048 MB',
      }),
=======
      baremetal.verifyServerConfig(
        createServerConfig({ freeSpaceRequired: '3GB' }),
      ),
    ).toThrow('"freeSpaceRequired" must be an integer >= 0')

    expect(() =>
      baremetal.verifyServerConfig(
        createServerConfig({ freeSpaceRequired: '2048 MB' }),
      ),
>>>>>>> 33ed75844c (chore(cli): migrate test files from JS to TypeScript (batch 3) (#2040)):packages/cli/src/commands/deploy/__tests__/baremetal.test.ts
    ).toThrow('"freeSpaceRequired" must be an integer >= 0')
  })

  it('throws an error if freeSpaceRequired is negative (as a string)', () => {
    expect(() =>
<<<<<<< HEAD:packages/cli/src/commands/deploy/__tests__/baremetal.test.js
      baremetalHandler.verifyServerConfig({
        host: 'host.test',
        path: '/var/www/app',
        repo: 'git://github.com',
        freeSpaceRequired: '-1',
      }),
=======
      baremetal.verifyServerConfig(
        createServerConfig({ freeSpaceRequired: '-1' }),
      ),
>>>>>>> 33ed75844c (chore(cli): migrate test files from JS to TypeScript (batch 3) (#2040)):packages/cli/src/commands/deploy/__tests__/baremetal.test.ts
    ).toThrow('"freeSpaceRequired" must be an integer >= 0')
  })

  it('throws an error if freeSpaceRequired is negative', () => {
    expect(() =>
<<<<<<< HEAD:packages/cli/src/commands/deploy/__tests__/baremetal.test.js
      baremetalHandler.verifyServerConfig({
        host: 'host.test',
        path: '/var/www/app',
        repo: 'git://github.com',
        freeSpaceRequired: -1,
      }),
=======
      baremetal.verifyServerConfig(
        createServerConfig({ freeSpaceRequired: -1 }),
      ),
>>>>>>> 33ed75844c (chore(cli): migrate test files from JS to TypeScript (batch 3) (#2040)):packages/cli/src/commands/deploy/__tests__/baremetal.test.ts
    ).toThrow('"freeSpaceRequired" must be an integer >= 0')
  })

  it('allows freeSpaceRequired to be 0 (as a string)', () => {
    expect(
<<<<<<< HEAD:packages/cli/src/commands/deploy/__tests__/baremetal.test.js
      baremetalHandler.verifyServerConfig({
        host: 'host.test',
        path: '/var/www/app',
        repo: 'git://github.com',
        freeSpaceRequired: '0',
      }),
=======
      baremetal.verifyServerConfig(
        createServerConfig({ freeSpaceRequired: '0' }),
      ),
>>>>>>> 33ed75844c (chore(cli): migrate test files from JS to TypeScript (batch 3) (#2040)):packages/cli/src/commands/deploy/__tests__/baremetal.test.ts
    ).toEqual(true)
  })

  it('allows freeSpaceRequired to be 0', () => {
    expect(
<<<<<<< HEAD:packages/cli/src/commands/deploy/__tests__/baremetal.test.js
      baremetalHandler.verifyServerConfig({
        host: 'host.test',
        path: '/var/www/app',
        repo: 'git://github.com',
        freeSpaceRequired: 0,
      }),
=======
      baremetal.verifyServerConfig(
        createServerConfig({ freeSpaceRequired: 0 }),
      ),
>>>>>>> 33ed75844c (chore(cli): migrate test files from JS to TypeScript (batch 3) (#2040)):packages/cli/src/commands/deploy/__tests__/baremetal.test.ts
    ).toEqual(true)
  })

  it('returns true if no problems', () => {
    expect(
<<<<<<< HEAD:packages/cli/src/commands/deploy/__tests__/baremetal.test.js
      baremetalHandler.verifyServerConfig({
        host: 'host.test',
        path: '/var/www/app',
        repo: 'git://github.com',
        freeSpaceRequired: 2024,
      }),
=======
      baremetal.verifyServerConfig(
        createServerConfig({ freeSpaceRequired: 2024 }),
      ),
>>>>>>> 33ed75844c (chore(cli): migrate test files from JS to TypeScript (batch 3) (#2040)):packages/cli/src/commands/deploy/__tests__/baremetal.test.ts
    ).toEqual(true)
  })
})

describe('maintenanceTasks', () => {
  it('returns tasks to put maintenance page up', () => {
    const tasks = baremetalHandler.maintenanceTasks(
      'up',
      sshExecutor,
      createServerConfig({ processNames: ['api'] }),
    )

    expect(tasks.length).toEqual(2)
    expect(tasks[0].title).toMatch('Enabling')
    expect(tasks[1].title).toMatch('Stopping')
  })

  it('returns tasks to take maintenance page down', () => {
    const tasks = baremetalHandler.maintenanceTasks(
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
    const tasks1 = baremetalHandler.rollbackTasks(
      1,
      sshExecutor,
      createServerConfig({ processNames: ['api'] }),
    )

    expect(tasks1.length).toEqual(2)
    expect(tasks1[0].title).toMatch('Rolling back 1')
    expect(tasks1[1].title).toMatch('Restarting')

    const tasks2 = baremetalHandler.rollbackTasks(
      5,
      sshExecutor,
      createServerConfig({ processNames: ['api'] }),
    )

    expect(tasks2[0].title).toMatch('Rolling back 5')
  })
})

describe('serverConfigWithDefaults', () => {
  it('provides some default settings', () => {
<<<<<<< HEAD:packages/cli/src/commands/deploy/__tests__/baremetal.test.js
    const config = baremetalHandler.serverConfigWithDefaults({}, {})
    expect(config).toEqual(baremetalHandler.DEFAULT_SERVER_CONFIG)
=======
    const config = baremetal.serverConfigWithDefaults(
      {},
      createBaremetalYargs(),
    )
    expect(config).toEqual(baremetal.DEFAULT_SERVER_CONFIG)
>>>>>>> 33ed75844c (chore(cli): migrate test files from JS to TypeScript (batch 3) (#2040)):packages/cli/src/commands/deploy/__tests__/baremetal.test.ts
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
<<<<<<< HEAD:packages/cli/src/commands/deploy/__tests__/baremetal.test.js
    const config = baremetalHandler.serverConfigWithDefaults(serverConfig, {})
=======
    const config = baremetal.serverConfigWithDefaults(
      serverConfig,
      createBaremetalYargs(),
    )
>>>>>>> 33ed75844c (chore(cli): migrate test files from JS to TypeScript (batch 3) (#2040)):packages/cli/src/commands/deploy/__tests__/baremetal.test.ts
    expect(config).toEqual(serverConfig)
  })

  it('provides default port as 22', () => {
<<<<<<< HEAD:packages/cli/src/commands/deploy/__tests__/baremetal.test.js
    const config = baremetalHandler.serverConfigWithDefaults({}, {})
=======
    const config = baremetal.serverConfigWithDefaults(
      {},
      createBaremetalYargs(),
    )
>>>>>>> 33ed75844c (chore(cli): migrate test files from JS to TypeScript (batch 3) (#2040)):packages/cli/src/commands/deploy/__tests__/baremetal.test.ts
    expect(config.port).toEqual(22)
  })

  it('provides default branch name', () => {
<<<<<<< HEAD:packages/cli/src/commands/deploy/__tests__/baremetal.test.js
    const config = baremetalHandler.serverConfigWithDefaults({}, {})
=======
    const config = baremetal.serverConfigWithDefaults(
      {},
      createBaremetalYargs(),
    )
>>>>>>> 33ed75844c (chore(cli): migrate test files from JS to TypeScript (batch 3) (#2040)):packages/cli/src/commands/deploy/__tests__/baremetal.test.ts
    expect(config.branch).toEqual('main')
  })

  it('overrides branch name from config', () => {
<<<<<<< HEAD:packages/cli/src/commands/deploy/__tests__/baremetal.test.js
    const config = baremetalHandler.serverConfigWithDefaults(
      { branch: 'earth' },
      {},
=======
    const config = baremetal.serverConfigWithDefaults(
      { branch: 'earth' },
      createBaremetalYargs(),
>>>>>>> 33ed75844c (chore(cli): migrate test files from JS to TypeScript (batch 3) (#2040)):packages/cli/src/commands/deploy/__tests__/baremetal.test.ts
    )
    expect(config.branch).toEqual('earth')
  })

  it('overrides branch name from yargs no matter what', () => {
    const config = baremetalHandler.serverConfigWithDefaults(
      { branch: 'earth' },
      createBaremetalYargs({ branch: 'moon' }),
    )
    expect(config.branch).toEqual('moon')
  })

  it('provides default freeSpaceRequired', () => {
<<<<<<< HEAD:packages/cli/src/commands/deploy/__tests__/baremetal.test.js
    const config = baremetalHandler.serverConfigWithDefaults({}, {})
=======
    const config = baremetal.serverConfigWithDefaults(
      {},
      createBaremetalYargs(),
    )
>>>>>>> 33ed75844c (chore(cli): migrate test files from JS to TypeScript (batch 3) (#2040)):packages/cli/src/commands/deploy/__tests__/baremetal.test.ts
    expect(config.freeSpaceRequired).toEqual(2048)
  })
})

describe('parseConfig', () => {
  it('returns the config for an environment', () => {
<<<<<<< HEAD:packages/cli/src/commands/deploy/__tests__/baremetal.test.js
    const { envConfig } = baremetalHandler.parseConfig(
      { environment: 'production' },
=======
    const { envConfig } = baremetal.parseConfig(
      createBaremetalYargs(),
>>>>>>> 33ed75844c (chore(cli): migrate test files from JS to TypeScript (batch 3) (#2040)):packages/cli/src/commands/deploy/__tests__/baremetal.test.ts
      `
        [[production.servers]]
        host = 'server.com'
      `,
    )

    expect(envConfig).toEqual({ servers: [{ host: 'server.com' }] })
  })

  it('returns the proper config from multiple environments', () => {
<<<<<<< HEAD:packages/cli/src/commands/deploy/__tests__/baremetal.test.js
    const { envConfig } = baremetalHandler.parseConfig(
      { environment: 'staging' },
=======
    const { envConfig } = baremetal.parseConfig(
      createBaremetalYargs({ environment: 'staging' }),
>>>>>>> 33ed75844c (chore(cli): migrate test files from JS to TypeScript (batch 3) (#2040)):packages/cli/src/commands/deploy/__tests__/baremetal.test.ts
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
<<<<<<< HEAD:packages/cli/src/commands/deploy/__tests__/baremetal.test.js
    const { _envConfig, envLifecycle } = baremetalHandler.parseConfig(
      { environment: 'production' },
=======
    const { envLifecycle } = baremetal.parseConfig(
      createBaremetalYargs(),
>>>>>>> 33ed75844c (chore(cli): migrate test files from JS to TypeScript (batch 3) (#2040)):packages/cli/src/commands/deploy/__tests__/baremetal.test.ts
      `
        [[production.servers]]
        host = 'server.com'
      `,
    )

    expect(envLifecycle.before).toEqual({})
    expect(envLifecycle.after).toEqual({})
  })

  it('parses a single global lifecycle event', () => {
<<<<<<< HEAD:packages/cli/src/commands/deploy/__tests__/baremetal.test.js
    const { _envConfig, envLifecycle } = baremetalHandler.parseConfig(
      { environment: 'production' },
=======
    const { envLifecycle } = baremetal.parseConfig(
      createBaremetalYargs(),
>>>>>>> 33ed75844c (chore(cli): migrate test files from JS to TypeScript (batch 3) (#2040)):packages/cli/src/commands/deploy/__tests__/baremetal.test.ts
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
<<<<<<< HEAD:packages/cli/src/commands/deploy/__tests__/baremetal.test.js
    const { _envConfig, envLifecycle } = baremetalHandler.parseConfig(
      { environment: 'production' },
=======
    const { envLifecycle } = baremetal.parseConfig(
      createBaremetalYargs(),
>>>>>>> 33ed75844c (chore(cli): migrate test files from JS to TypeScript (batch 3) (#2040)):packages/cli/src/commands/deploy/__tests__/baremetal.test.ts
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
<<<<<<< HEAD:packages/cli/src/commands/deploy/__tests__/baremetal.test.js
    const { _envConfig, envLifecycle } = baremetalHandler.parseConfig(
      { environment: 'production' },
=======
    const { envLifecycle } = baremetal.parseConfig(
      createBaremetalYargs(),
>>>>>>> 33ed75844c (chore(cli): migrate test files from JS to TypeScript (batch 3) (#2040)):packages/cli/src/commands/deploy/__tests__/baremetal.test.ts
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
<<<<<<< HEAD:packages/cli/src/commands/deploy/__tests__/baremetal.test.js
    const { _envConfig, envLifecycle } = baremetalHandler.parseConfig(
      { environment: 'production' },
=======
    const { envLifecycle } = baremetal.parseConfig(
      createBaremetalYargs(),
>>>>>>> 33ed75844c (chore(cli): migrate test files from JS to TypeScript (batch 3) (#2040)):packages/cli/src/commands/deploy/__tests__/baremetal.test.ts
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
<<<<<<< HEAD:packages/cli/src/commands/deploy/__tests__/baremetal.test.js
    const { _envConfig, envLifecycle } = baremetalHandler.parseConfig(
      { environment: 'production' },
=======
    const { envLifecycle } = baremetal.parseConfig(
      createBaremetalYargs(),
>>>>>>> 33ed75844c (chore(cli): migrate test files from JS to TypeScript (batch 3) (#2040)):packages/cli/src/commands/deploy/__tests__/baremetal.test.ts
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
<<<<<<< HEAD:packages/cli/src/commands/deploy/__tests__/baremetal.test.js
    } = baremetalHandler.parseConfig(
      { environment: 'production' },
=======
    } = baremetal.parseConfig(
      createBaremetalYargs(),
>>>>>>> 33ed75844c (chore(cli): migrate test files from JS to TypeScript (batch 3) (#2040)):packages/cli/src/commands/deploy/__tests__/baremetal.test.ts
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
    const tasks = baremetalHandler.commandWithLifecycleEvents({
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
    const tasks = baremetalHandler.commandWithLifecycleEvents({
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
    const tasks = baremetalHandler.commandWithLifecycleEvents({
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
    const tasks = baremetalHandler.commandWithLifecycleEvents({
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
    const tasks = baremetalHandler.commandWithLifecycleEvents({
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
    const tasks = baremetalHandler.commandWithLifecycleEvents({
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
    const tasks = baremetalHandler.commandWithLifecycleEvents({
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
    const tasks = baremetalHandler.commandWithLifecycleEvents({
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
    const tasks = baremetalHandler.commandWithLifecycleEvents({
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
    const tasks = baremetalHandler.deployTasks(
      defaultYargs,
      sshExecutor,
      defaultServerConfig,
      { before: {}, after: {} },
    )

    expect(Object.keys(tasks).length).toEqual(9)
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
    expect(tasks[6].title).toMatch('Symlinking current')
    expect(tasks[6].skip?.()).toEqual(false)
    expect(tasks[7].title).toMatch('Restarting serve')
    expect(tasks[7].skip?.()).toEqual(false)
    expect(tasks[8].title).toMatch('Cleaning up')
    expect(tasks[8].skip?.()).toEqual(false)
  })

  it('skips the available space check if --no-df is passed', () => {
    const tasks = baremetalHandler.deployTasks(
      { ...defaultYargs, df: false },
      sshExecutor,
      defaultServerConfig,
      { before: {}, after: {} },
    )

    expect(tasks[0].skip?.()).toBeTruthy()
  })

  it('skips the available space check if freeSpaceRequired is set to 0', () => {
    const tasks = baremetalHandler.deployTasks(
      { ...defaultYargs },
      sshExecutor,
      { ...defaultServerConfig, freeSpaceRequired: 0 },
      { before: {}, after: {} },
    )

    expect(tasks[0].skip?.()).toBeTruthy()
  })

<<<<<<< HEAD:packages/cli/src/commands/deploy/__tests__/baremetal.test.js
  it('throws an error if there is not enough available space on the server and freeSpaceRequired is not configured', () => {
    const ssh = {
      exec: () => ({ stdout: 'df:1875893' }),
    }

    const { freeSpaceRequired: _, ...serverConfig } = defaultServerConfig
=======
  it('throws an error if there is not enough available space on the server and freeSpaceRequired is not configured', async () => {
    vi.spyOn(sshExecutor, 'exec').mockResolvedValue({
      stdout: 'df:1875893',
      stderr: '',
      code: 0,
      signal: null,
    })
>>>>>>> 33ed75844c (chore(cli): migrate test files from JS to TypeScript (batch 3) (#2040)):packages/cli/src/commands/deploy/__tests__/baremetal.test.ts

    const tasks = baremetalHandler.deployTasks(
      defaultYargs,
      sshExecutor,
      createServerConfig({ sides: ['api', 'web'] }),
      { before: {}, after: {} },
    )

    expect(() => tasks[0].task({}, {})).rejects.toThrowError(
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

    const tasks = baremetalHandler.deployTasks(
      defaultYargs,
      sshExecutor,
      {
        ...defaultServerConfig,
        sides: ['api', 'web'],
        freeSpaceRequired: 4096,
      },
      { before: {}, after: {} },
    )

    expect(() => tasks[0].task({}, {})).rejects.toThrowError(
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

    const tasks = baremetalHandler.deployTasks(
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

    const tasks = baremetalHandler.deployTasks(
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
    const tasks = baremetalHandler.deployTasks(
      defaultYargs,
      sshExecutor,
      { ...defaultServerConfig, sides: ['api', 'web'] },
      { before: {}, after: {} },
    )

    expect(Object.keys(tasks).length).toEqual(10)
    expect(tasks[5].title).toMatch('Building api')
    expect(tasks[6].title).toMatch('Building web')
  })

  it('skips migrations if migrate = false in config', () => {
    const tasks = baremetalHandler.deployTasks(
      defaultYargs,
      sshExecutor,
      { ...defaultServerConfig, migrate: false },
      { before: {}, after: {} },
    )

    expect(Object.keys(tasks).length).toEqual(9)
    expect(tasks[4].skip?.()).toEqual(true)
  })

  it('starts pm2 if --first-run flag set', () => {
    const tasks = baremetalHandler.deployTasks(
      { ...defaultYargs, firstRun: true },
      sshExecutor,
      defaultServerConfig,
      { before: {}, after: {} },
    )

    expect(Object.keys(tasks).length).toEqual(10)
    expect(tasks[7].title).toMatch('Starting serve')
    expect(tasks[8].title).toMatch('Saving serve')
  })

  it('skips clone and symlinks if --no-update flag passed', () => {
    const tasks = baremetalHandler.deployTasks(
      { ...defaultYargs, update: false },
      sshExecutor,
      defaultServerConfig,
      { before: {}, after: {} },
    )

    expect(tasks[1].skip?.()).toEqual(true)
    expect(tasks[2].skip?.()).toEqual(true)
    expect(tasks[6].skip?.()).toEqual(true)
  })

  it('skips install if --no-install flag passed', () => {
    const tasks = baremetalHandler.deployTasks(
      { ...defaultYargs, install: false },
      sshExecutor,
      defaultServerConfig,
      { before: {}, after: {} },
    )

    expect(tasks[3].skip?.()).toEqual(true)
  })

  it('skips migrations if --no-migrate flag passed', () => {
    const tasks = baremetalHandler.deployTasks(
      { ...defaultYargs, migrate: false },
      sshExecutor,
      defaultServerConfig,
      { before: {}, after: {} },
    )

    expect(tasks[4].skip?.()).toEqual(true)
  })

  it('skips build if --no-build flag passed', () => {
    const tasks = baremetalHandler.deployTasks(
      { ...defaultYargs, build: false },
      sshExecutor,
      defaultServerConfig,
      { before: {}, after: {} },
    )

    expect(tasks[5].skip?.()).toEqual(true)
  })

  it('skips restart if --no-restart flag passed', () => {
    const tasks = baremetalHandler.deployTasks(
      { ...defaultYargs, restart: false },
      sshExecutor,
      defaultServerConfig,
      { before: {}, after: {} },
    )

    expect(tasks[7].skip?.()).toEqual(true)
  })

  it('skips cleanup if --no-cleanup flag passed', () => {
    const tasks = baremetalHandler.deployTasks(
      { ...defaultYargs, cleanup: false },
      sshExecutor,
      defaultServerConfig,
      { before: {}, after: {} },
    )

    expect(tasks[8].skip?.()).toEqual(true)
  })

  it('injects lifecycle events for update', () => {
    const tasks = baremetalHandler.deployTasks(
      defaultYargs,
      sshExecutor,
      defaultServerConfig,
      { before: { update: ['touch before-update.txt'] }, after: {} },
    )

    expect(Object.keys(tasks).length).toEqual(10)
    expect(tasks[1].title).toMatch('Before update: `touch before-update.txt`')
    expect(tasks[2].title).toMatch('Cloning')
  })

  it('injects lifecycle events for install', () => {
    const tasks = baremetalHandler.deployTasks(
      defaultYargs,
      sshExecutor,
      defaultServerConfig,
      { before: { install: ['touch before-install.txt'] }, after: {} },
    )

    expect(Object.keys(tasks).length).toEqual(10)
    expect(tasks[3].title).toMatch('Before install: `touch before-install.txt`')
    expect(tasks[4].title).toMatch('Install')
  })

  it('injects lifecycle events for migrate', () => {
    const tasks = baremetalHandler.deployTasks(
      defaultYargs,
      sshExecutor,
      defaultServerConfig,
      { before: { migrate: ['touch before-migrate.txt'] }, after: {} },
    )

    expect(Object.keys(tasks).length).toEqual(10)
    expect(tasks[4].title).toMatch('Before migrate: `touch before-migrate.txt`')
    expect(tasks[5].title).toMatch('DB Migrations')
  })

  it('injects lifecycle events for build', () => {
    const tasks = baremetalHandler.deployTasks(
      defaultYargs,
      sshExecutor,
      defaultServerConfig,
      { before: { build: ['touch before-build.txt'] }, after: {} },
    )

    expect(Object.keys(tasks).length).toEqual(10)
    expect(tasks[5].title).toMatch('Before build: `touch before-build.txt`')
    expect(tasks[6].title).toMatch('Building api')
  })

  it('injects lifecycle events for restart', () => {
    const tasks = baremetalHandler.deployTasks(
      defaultYargs,
      sshExecutor,
      defaultServerConfig,
      { before: { restart: ['touch before-restart.txt'] }, after: {} },
    )

    expect(Object.keys(tasks).length).toEqual(10)
    expect(tasks[7].title).toMatch('Before restart: `touch before-restart.txt`')
    expect(tasks[8].title).toMatch('Restarting')
  })

  it('injects lifecycle events for cleanup', () => {
    const tasks = baremetalHandler.deployTasks(
      defaultYargs,
      sshExecutor,
      defaultServerConfig,
      { before: { cleanup: ['touch before-cleanup.txt'] }, after: {} },
    )

    expect(Object.keys(tasks).length).toEqual(10)
    expect(tasks[8].title).toMatch('Before cleanup: `touch before-cleanup.txt`')
    expect(tasks[9].title).toMatch('Cleaning up')
  })
})

describe('commands', () => {
  it('contains a top-level task for each server in an environment', () => {
    const prodServers = baremetalHandler.commands(
      { environment: 'production', releaseDir: '2022051120000' },
      sshExecutor,
    )
    const stagingServers = baremetalHandler.commands(
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
    const servers = baremetalHandler.commands(
      { environment: 'staging', releaseDir: '2022051120000' },
      sshExecutor,
    )

    expect(servers[0].task()).toBeInstanceOf(Listr)
  })

  it('contains connection and disconnection tasks', () => {
    const servers = baremetalHandler.commands(
      { environment: 'staging', releaseDir: '2022051120000' },
      sshExecutor,
    )
    const tasks = servers[0].task().tasks

    expect(tasks[0].title).toMatch('Connecting')
    expect(tasks[10].title).toMatch('Disconnecting')
  })

  it('contains deploy tasks by default', () => {
    const servers = baremetalHandler.commands(
      { environment: 'staging', releaseDir: '2022051120000' },
      sshExecutor,
    )
    const tasks = servers[0].task().tasks

    expect(tasks[2].title).toMatch('Cloning')
  })

  it('contains maintenance tasks if yargs are set', () => {
    const servers = baremetalHandler.commands(
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
    const servers = baremetalHandler.commands(
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
    const servers = baremetalHandler.commands(
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
<<<<<<< HEAD:packages/cli/src/commands/deploy/__tests__/baremetal.test.js
    await expect(baremetalHandler.handler({})).rejects.toThrowError(
      'process.exit: 1',
    )
=======
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
>>>>>>> 33ed75844c (chore(cli): migrate test files from JS to TypeScript (batch 3) (#2040)):packages/cli/src/commands/deploy/__tests__/baremetal.test.ts
    expect(vi.mocked(console).error).toHaveBeenCalledWith(
      expect.stringContaining('Baremetal deploy has not been properly setup'),
    )
  })
})
