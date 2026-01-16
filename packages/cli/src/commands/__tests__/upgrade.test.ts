import fs from 'node:fs'

import { dedent } from 'ts-dedent'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

import { runPreUpgradeScripts } from '../upgrade/preUpgradeScripts.js'

// Mock fetch globally
global.fetch = vi.fn()

vi.mock('node:fs', () => ({
  default: {
    promises: {
      mkdtemp: vi.fn(() => '/tmp/cedar-upgrade-abc123'),
      writeFile: vi.fn(),
      readFile: vi.fn(),
      rename: vi.fn(),
      rm: vi.fn(),
    },
    rmSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    realpathSync: (path: string) => path,
  },
}))

vi.mock('execa', () => ({
  default: vi.fn(),
}))

vi.mock('node:os', () => ({
  default: {
    tmpdir: vi.fn(() => '/tmp'),
  },
}))

describe('runPreUpgradeScripts', () => {
  let mockTask: { output: string }
  let mockCtx: Record<string, unknown>

  beforeEach(() => {
    mockTask = {
      output: '',
    }
    mockCtx = {}

    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('should return early when no versionToUpgradeTo is provided', async () => {
    const ctx = {}
    const task = { output: '' }

    await runPreUpgradeScripts(ctx, task, { verbose: false, force: false })

    expect(fetch).not.toHaveBeenCalled()
    expect(ctx).toEqual({})
  })

  it('should return early when manifest is empty array', async () => {
    mockCtx.versionToUpgradeTo = '3.4.1'

    vi.mocked(fetch).mockResolvedValue({
      status: 200,
      json: async () => [],
    } as Response)

    await runPreUpgradeScripts(mockCtx, mockTask, {
      verbose: false,
      force: false,
    })

    expect(fetch).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/cedarjs/cedar/main/upgrade-scripts/manifest.json',
    )
    expect(mockCtx.preUpgradeMessage).toBeUndefined()
  })

  it('should log when manifest is not found and verbose is true', async () => {
    mockCtx.versionToUpgradeTo = '3.4.1'
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    vi.mocked(fetch).mockResolvedValueOnce({
      status: 404,
      ok: false,
      statusText: 'Not Found',
      // a proper Response object has a lot of properties and methods. For a
      // test it's not worth it to mock all of them.
    } as Response)

    await runPreUpgradeScripts(mockCtx, mockTask, {
      verbose: true,
      force: false,
    })

    expect(consoleLogSpy).toHaveBeenCalledWith(
      'No upgrade script manifest found.',
    )
  })

  it('should download script, parse dependencies, and execute', async () => {
    const execa = await import('execa')

    mockCtx.versionToUpgradeTo = '3.4.1'

    // Script content with both explicit and implicit dependencies
    const scriptContent = dedent`
      // Explicit dependencies with and without specifying an exact version
      // @dependency: yargs
      // @dependency: lodash@^4.17.0
      // @dependency: @cedarjs/internal@1.0.0

      // node: protocol import
      import fs from 'node:fs'

      // built-in module without using the node: protocol
      import path from 'path'

      import semver from 'semver'

      import { Something } from '@cedarjs/structure'

      import foo from './foo'

      async function dynamicImport() {
        const { execa } = await import('execa')
        return await import('./dynamic.ts')
      }

      // The output is not captured by the test. We're not actually running the
      // script as part of the test.
      console.log('Running upgrade check')
    `

    // Mock readFile to return the script content
    vi.mocked(fs.promises.readFile).mockResolvedValue(scriptContent)

    vi.mocked(fetch).mockImplementation(async (url: string | URL | Request) => {
      if (url.toString().endsWith('/manifest.json')) {
        return {
          status: 200,
          json: async () => ['3.4.1.ts'],
          // a proper Response object has a lot of properties and methods. For a
          // test it's not worth it to mock all of them.
        } as Response
      } else if (url.toString().endsWith('/3.4.1.ts')) {
        // Mock script download
        return {
          status: 200,
          text: async () => scriptContent,
          // a proper Response object has a lot of properties and methods. For a
          // test it's not worth it to mock all of them.
        } as Response
      }

      throw new Error(`Unexpected url: ${url}`)
    })

    vi.mocked(execa.default).mockImplementation(
      // TypeScript is struggling with the type for the function overload and
      // for a test it's not worth it to mock this properly.
      // @ts-expect-error - Only mocking the implementation we're using
      (
        command: string,
        argsOrOptions: string[] | unknown,
        _maybeOptions: unknown,
      ) => {
        // Handle overloaded signature where second param could be options
        const actualArgs = Array.isArray(argsOrOptions) ? argsOrOptions : []

        if (command === 'npm' && actualArgs?.includes('install')) {
          return {
            stdout: '',
            stderr: '',
          }
        } else if (command === 'node') {
          return {
            stdout: 'Upgrade check passed',
            stderr: '',
          }
        }

        throw new Error(
          `Unexpected command: ${command} ${actualArgs?.join(' ')}`,
        )
      },
    )

    await runPreUpgradeScripts(mockCtx, mockTask, {
      verbose: false,
      force: false,
    })

    // Verify fetch was called to read the manifest
    expect(fetch).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/cedarjs/cedar/main/upgrade-scripts/manifest.json',
    )

    // Verify fetch was called to download the script
    expect(fetch).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/cedarjs/cedar/main/upgrade-scripts/3.4.1.ts',
    )

    // Verify npm install was called with correct dependencies
    // Should include: lodash@^4.17.0, @cedarjs/internal, @cedarjs/structure, axios
    // Should NOT include: node:fs (built-in module)
    expect(execa.default).toHaveBeenCalledWith(
      'npm',
      [
        'install',
        'yargs',
        'lodash@^4.17.0',
        '@cedarjs/internal@1.0.0',
        'semver',
        '@cedarjs/structure@3.4.1',
        'execa',
      ],
      { cwd: '/tmp/cedar-upgrade-abc123' },
    )

    // Verify script was executed
    expect(execa.default).toHaveBeenCalledWith(
      'node',
      ['script.mts', '--verbose', 'false', '--force', 'false'],
      {
        cwd: '/tmp/cedar-upgrade-abc123',
      },
    )

    const preUpgradeMessage = mockCtx.preUpgradeMessage

    if (typeof preUpgradeMessage !== 'string') {
      throw new Error('preUpgradeMessage is not a string')
    }

    // Verify output was captured
    expect(preUpgradeMessage).toContain('Upgrade check passed')

    // Verify cleanup
    expect(fs.promises.rm).toHaveBeenCalledWith('/tmp/cedar-upgrade-abc123', {
      recursive: true,
    })
  })
})
