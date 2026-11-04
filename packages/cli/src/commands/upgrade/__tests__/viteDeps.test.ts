import packageJson, { VersionNotFoundError } from 'package-json'
import type * as PackageJsonModule from 'package-json'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  addPnpmViteOverride,
  addVitePin,
  fetchVitestReleasePackages,
  fetchViteVersions,
  updatePnpmViteOverride,
  updateViteDependencies,
} from '../upgradeHandler.js'

vi.mock('package-json', async (importOriginal) => ({
  ...(await importOriginal<typeof PackageJsonModule>()),
  default: vi.fn(),
}))

const versions = { vite: '8.3.5', vitest: '5.1.0' }

describe('updateViteDependencies', () => {
  it('updates vite, vitest and the @vitest packages the project declares', () => {
    const pkg = {
      dependencies: { '@cedarjs/web': '7.1.0' },
      devDependencies: {
        '@cedarjs/vite': '7.1.0',
        '@vitest/coverage-v8': '5.0.5',
        '@vitest/eslint-plugin': '1.6.28',
        vite: '7.3.7',
        vitest: '5.0.5',
      },
    }

    const updated = updateViteDependencies(pkg, versions, [], {
      vitestPackages: new Set(['@vitest/coverage-v8']),
    })

    expect(updated).toBe(true)
    expect(pkg).toEqual({
      dependencies: { '@cedarjs/web': '7.1.0' },
      devDependencies: {
        '@cedarjs/vite': '7.1.0',
        '@vitest/coverage-v8': '5.1.0',
        '@vitest/eslint-plugin': '1.6.28',
        vite: '8.3.5',
        vitest: '5.1.0',
      },
    })
  })

  it("doesn't add packages the project doesn't declare", () => {
    const pkg = { devDependencies: { '@cedarjs/core': '7.1.0' } }

    const updated = updateViteDependencies(pkg, versions, [])

    expect(updated).toBe(false)
    expect(pkg).toEqual({ devDependencies: { '@cedarjs/core': '7.1.0' } })
  })

  it('leaves packages alone when the release declares no version', () => {
    const pkg = { devDependencies: { vite: '7.3.7', vitest: '5.0.5' } }

    const updated = updateViteDependencies(pkg, { vite: '8.3.5' }, [])

    expect(updated).toBe(true)
    expect(pkg.devDependencies).toEqual({ vite: '8.3.5', vitest: '5.0.5' })
  })

  it('updates the vite pin in resolutions and overrides', () => {
    const pkg = {
      resolutions: { 'react-is': '19.3.1', vite: '7.3.7' },
      overrides: { 'react-is': '19.3.1', vite: '7.3.7' },
    }

    const updated = updateViteDependencies(pkg, versions, [])

    expect(updated).toBe(true)
    expect(pkg).toEqual({
      resolutions: { 'react-is': '19.3.1', vite: '8.3.5' },
      overrides: { 'react-is': '19.3.1', vite: '8.3.5' },
    })
  })

  it('leaves nested npm overrides alone', () => {
    const pkg = { overrides: { vite: { esbuild: '0.25.0' } } }

    const updated = updateViteDependencies(pkg, versions, [])

    expect(updated).toBe(false)
    expect(pkg).toEqual({ overrides: { vite: { esbuild: '0.25.0' } } })
  })

  it('only reports changes when verbose or dry run', () => {
    const quiet: string[] = []
    const loud: string[] = []

    updateViteDependencies(
      { devDependencies: { vite: '7.3.7' }, resolutions: { vite: '7.3.7' } },
      versions,
      quiet,
    )
    updateViteDependencies(
      { devDependencies: { vite: '7.3.7' }, resolutions: { vite: '7.3.7' } },
      versions,
      loud,
      { verbose: true },
    )

    expect(quiet).toEqual([])
    expect(loud).toEqual([
      ' - vite: 7.3.7 => 8.3.5',
      ' - resolutions.vite: 7.3.7 => 8.3.5',
    ])
  })
})

describe('updatePnpmViteOverride', () => {
  const workspace = [
    'autoInstallPeers: false',
    '',
    'packages:',
    '  - api',
    '  - web',
    '',
    'overrides:',
    "  'react-is': '19.3.1'",
    "  'vite': '7.3.7'",
    '',
  ].join('\n')

  it('updates the vite override and keeps the rest of the file', () => {
    expect(updatePnpmViteOverride(workspace, '8.3.5')).toBe(
      workspace.replace("'vite': '7.3.7'", "'vite': '8.3.5'"),
    )
  })

  it('handles unquoted keys and values', () => {
    const content = 'overrides:\n  vite: 7.3.7 # pinned for Cedar\n'

    expect(updatePnpmViteOverride(content, '8.3.5')).toBe(
      'overrides:\n  vite: 8.3.5 # pinned for Cedar\n',
    )
  })

  it('returns undefined when the override is already up to date', () => {
    expect(
      updatePnpmViteOverride(workspace.replace('7.3.7', '8.3.5'), '8.3.5'),
    ).toBeUndefined()
  })

  it('returns undefined when there are no overrides', () => {
    expect(
      updatePnpmViteOverride('packages:\n  - api\n  - web\n', '8.3.5'),
    ).toBeUndefined()
  })

  it('only looks inside the top-level overrides block', () => {
    const content = [
      'overrides:',
      "  'react-is': '19.3.1'",
      'catalog:',
      "  vite: '7.3.7'",
      '',
    ].join('\n')

    expect(updatePnpmViteOverride(content, '8.3.5')).toBeUndefined()
  })

  it('handles a comment on the overrides line and column-0 comments', () => {
    const content = [
      'overrides: # pinned for Cedar',
      "  'react-is': '19.3.1'",
      '# Cedar needs this exact version',
      "  vite: '7.3.7'",
      '',
    ].join('\n')

    expect(updatePnpmViteOverride(content, '8.3.5')).toBe(
      content.replace("vite: '7.3.7'", "vite: '8.3.5'"),
    )
  })

  it('keeps CRLF line endings', () => {
    const content = workspace.replaceAll('\n', '\r\n')

    expect(updatePnpmViteOverride(content, '8.3.5')).toBe(
      content.replace("'vite': '7.3.7'", "'vite': '8.3.5'"),
    )
  })

  it("doesn't match packages whose name starts with vite", () => {
    const content = "overrides:\n  'vite-plugin-foo': '1.0.0'\n"

    expect(updatePnpmViteOverride(content, '8.3.5')).toBeUndefined()
  })
})

describe('fetchViteVersions', () => {
  const packageJsonMock = vi.mocked(packageJson)

  beforeEach(() => {
    packageJsonMock.mockReset()
  })

  function stubRegistry(manifests: Record<string, Record<string, unknown>>) {
    packageJsonMock.mockImplementation(async (name) => {
      const manifest = manifests[String(name)]

      if (!manifest) {
        throw new Error(`Package \`${name}\` could not be found`)
      }

      // The tests only read the fields these manifests set
      return manifest as Awaited<ReturnType<typeof packageJson>>
    })
  }

  it("returns @cedarjs/vite's vite and @cedarjs/testing's vitest versions", async () => {
    stubRegistry({
      '@cedarjs/vite': { dependencies: { vite: '8.3.5' } },
      '@cedarjs/testing': { peerDependencies: { vitest: '5.1.0' } },
    })

    await expect(fetchViteVersions('7.2.0+abc1234')).resolves.toEqual({
      vite: '8.3.5',
      vitest: '5.1.0',
    })
    expect(packageJsonMock).toHaveBeenCalledWith('@cedarjs/vite', {
      version: '7.2.0',
    })
    expect(packageJsonMock).toHaveBeenCalledWith('@cedarjs/testing', {
      version: '7.2.0',
    })
  })

  it("returns undefined for versions the release doesn't declare", async () => {
    stubRegistry({
      '@cedarjs/vite': { dependencies: {} },
      '@cedarjs/testing': { dependencies: { vitest: '5.1.0' } },
    })

    await expect(fetchViteVersions('7.1.0')).resolves.toEqual({
      vite: undefined,
      vitest: undefined,
    })
  })

  it('throws when the registry lookup fails', async () => {
    stubRegistry({ '@cedarjs/vite': { dependencies: { vite: '8.3.5' } } })

    await expect(fetchViteVersions('7.1.0')).rejects.toThrow(
      'Failed to fetch @cedarjs/testing@7.1.0 from the npm registry: ' +
        'Package `@cedarjs/testing` could not be found',
    )
  })
})

describe('fetchVitestReleasePackages', () => {
  const packageJsonMock = vi.mocked(packageJson)

  beforeEach(() => {
    packageJsonMock.mockReset()
  })

  it('returns the @vitest packages published at the vitest version', async () => {
    const published: Record<string, string[]> = {
      '@vitest/coverage-v8': ['5.0.5', '5.1.0'],
      '@vitest/eslint-plugin': ['1.6.28'],
    }

    packageJsonMock.mockImplementation(async (name, options) => {
      const version = String(options?.version)

      if (!published[String(name)]?.includes(version)) {
        throw new VersionNotFoundError(String(name), version)
      }

      // The tests don't read the manifest
      return {} as Awaited<ReturnType<typeof packageJson>>
    })

    const vitestPackages = await fetchVitestReleasePackages(
      [
        'vitest',
        '@vitest/coverage-v8',
        '@vitest/eslint-plugin',
        '@vitest/coverage-v8',
      ],
      '5.1.0',
    )

    expect(vitestPackages).toEqual(new Set(['@vitest/coverage-v8']))
    expect(packageJsonMock).toHaveBeenCalledTimes(2)
  })

  it('throws when the registry lookup fails', async () => {
    packageJsonMock.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'))

    await expect(
      fetchVitestReleasePackages(['@vitest/ui'], '5.1.0'),
    ).rejects.toThrow(
      'Failed to fetch @vitest/ui@5.1.0 from the npm registry: ' +
        'getaddrinfo ENOTFOUND',
    )
  })
})

describe('addVitePin', () => {
  it('adds resolutions.vite for yarn', () => {
    const pkg = { resolutions: { 'react-is': '19.3.1' } }
    const messages: string[] = []

    expect(addVitePin(pkg, 'yarn', '8.3.5', messages)).toBe(true)
    expect(pkg).toEqual({
      resolutions: { 'react-is': '19.3.1', vite: '8.3.5' },
    })
    expect(messages).toEqual([' - resolutions.vite: added at 8.3.5'])
  })

  it('adds overrides.vite for npm', () => {
    const pkg = {}
    const messages: string[] = []

    expect(addVitePin(pkg, 'npm', '8.3.5', messages)).toBe(true)
    expect(pkg).toEqual({ overrides: { vite: '8.3.5' } })
    expect(messages).toEqual([' - overrides.vite: added at 8.3.5'])
  })

  it("adds the pin for a project that doesn't declare vitest", () => {
    const pkg = {
      devDependencies: { '@cedarjs/core': '7.1.0' },
      resolutions: { 'react-is': '19.3.1' },
    }

    expect(addVitePin(pkg, 'yarn', '8.3.5', [])).toBe(true)
    expect(pkg.resolutions).toEqual({ 'react-is': '19.3.1', vite: '8.3.5' })
  })

  it("doesn't add a package.json pin for pnpm", () => {
    const pkg = {}

    expect(addVitePin(pkg, 'pnpm', '8.3.5', [])).toBe(false)
    expect(pkg).toEqual({})
  })

  it("doesn't add a pin that's already there", () => {
    const yarnPkg = { resolutions: { vite: '7.3.7' } }
    const npmPkg = { overrides: { vite: { esbuild: '0.25.0' } } }
    const messages: string[] = []

    expect(addVitePin(yarnPkg, 'yarn', '8.3.5', messages)).toBe(false)
    expect(addVitePin(npmPkg, 'npm', '8.3.5', messages)).toBe(false)
    expect(yarnPkg).toEqual({ resolutions: { vite: '7.3.7' } })
    expect(npmPkg).toEqual({ overrides: { vite: { esbuild: '0.25.0' } } })
    expect(messages).toEqual([])
  })

  it('uses resolutions, not overrides, for yarn', () => {
    const pkg = { overrides: { 'react-is': '19.3.1' } }

    expect(addVitePin(pkg, 'yarn', '8.3.5', [])).toBe(true)
    expect(pkg).toEqual({
      overrides: { 'react-is': '19.3.1' },
      resolutions: { vite: '8.3.5' },
    })
  })
})

describe('addPnpmViteOverride', () => {
  it('adds vite to an existing overrides block in its style', () => {
    const content = [
      'packages:',
      '  - api',
      '  - web',
      '',
      'overrides:',
      "  'react-is': '19.3.1'",
      '',
      'allowBuilds:',
      '  esbuild: true',
      '',
    ].join('\n')

    expect(addPnpmViteOverride(content, '8.3.5')).toBe(
      content.replace(
        "  'react-is': '19.3.1'\n",
        "  'react-is': '19.3.1'\n  'vite': '8.3.5'\n",
      ),
    )
  })

  it('uses unquoted keys when the existing entries do', () => {
    const content = 'overrides:\n  react-is: 19.3.1\n'

    expect(addPnpmViteOverride(content, '8.3.5')).toBe(
      'overrides:\n  react-is: 19.3.1\n  vite: 8.3.5\n',
    )
  })

  it('appends an overrides block when the file has none', () => {
    const content = 'packages:\n  - api\n  - web\n'

    expect(addPnpmViteOverride(content, '8.3.5')).toBe(
      "packages:\n  - api\n  - web\n\noverrides:\n  vite: '8.3.5'\n",
    )
  })

  it('keeps CRLF line endings', () => {
    expect(
      addPnpmViteOverride("overrides:\r\n  'react-is': '19.3.1'\r\n", '8.3.5'),
    ).toBe("overrides:\r\n  'react-is': '19.3.1'\r\n  'vite': '8.3.5'\r\n")
    expect(addPnpmViteOverride('packages:\r\n  - web\r\n', '8.3.5')).toBe(
      "packages:\r\n  - web\r\n\r\noverrides:\r\n  vite: '8.3.5'\r\n",
    )
  })

  it('returns undefined when overrides already has vite', () => {
    expect(
      addPnpmViteOverride("overrides:\n  'vite': '7.3.7'\n", '8.3.5'),
    ).toBeUndefined()
  })

  it('returns undefined for flow-style overrides', () => {
    expect(
      addPnpmViteOverride("overrides: { 'react-is': '19.3.1' }\n", '8.3.5'),
    ).toBeUndefined()
  })
})
