import fs from 'fs-extra'
import { dedent } from 'ts-dedent'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// @ts-expect-error - JS file
import { runPreUpgradeScripts } from '../upgrade.js'

// Mock fetch globally
global.fetch = vi.fn()

vi.mock('fs-extra', () => ({
  default: {
    mkdtemp: () => '/tmp/cedar-upgrade-abc123',
    writeFile: vi.fn(),
    writeJson: vi.fn(),
    remove: vi.fn(),
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
  let mockTask: any
  let mockCtx: any

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
    })

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
    })

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

    vi.mocked(fetch).mockImplementation(async (url: string) => {
      if (url.endsWith('/manifest.json')) {
        return {
          status: 200,
          json: async () => ['3.4.1.ts'],
        }
      } else if (url.endsWith('/3.4.1.ts')) {
        // Mock script download
        return {
          status: 200,
          text: async () => scriptContent,
        }
      }

      throw new Error(`Unexpected url: ${url}`)
    })

    vi.mocked(execa.default).mockImplementation(async (command, args) => {
      if (command === 'yarn' && args.includes('add')) {
        return { stdout: '', stderr: '' }
      } else if (command === 'node') {
        return {
          stdout: 'Upgrade check passed',
          stderr: '',
        }
      }

      throw new Error(`Unexpected command: ${command} ${args.join(' ')}`)
    })

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

    // Verify yarn add was called with correct dependencies
    // Should include: lodash@^4.17.0, @cedarjs/internal, @cedarjs/structure, axios
    // Should NOT include: node:fs (built-in module)
    expect(execa.default).toHaveBeenCalledWith(
      'yarn',
      [
        'add',
        'yargs',
        'lodash@^4.17.0',
        '@cedarjs/internal@1.0.0',
        'semver',
        '@cedarjs/structure',
        'execa',
      ],
      { cwd: '/tmp/cedar-upgrade-abc123' },
    )

    // Verify script was executed
    expect(execa.default).toHaveBeenCalledWith(
      'node',
      ['check.ts', '--verbose', false, '--force', false],
      {
        cwd: '/tmp/cedar-upgrade-abc123',
      },
    )

    // Verify output was captured
    expect(mockCtx.preUpgradeMessage).toContain('--- Output from 3.4.1.ts ---')
    expect(mockCtx.preUpgradeMessage).toContain('Upgrade check passed')

    // Verify cleanup
    expect(fs.remove).toHaveBeenCalledWith('/tmp/cedar-upgrade-abc123')
  })
})
