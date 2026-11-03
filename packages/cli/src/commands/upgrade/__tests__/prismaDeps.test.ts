import packageJson from 'package-json'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  addMissingDependency,
  fetchPrismaPeerVersion,
  updatePrismaDependencies,
} from '../upgradeHandler.js'

vi.mock('package-json', () => ({ default: vi.fn() }))

describe('updatePrismaDependencies', () => {
  it('updates the Prisma packages the project declares', () => {
    const pkg = {
      dependencies: {
        '@cedarjs/api': '7.1.0',
        '@prisma/adapter-better-sqlite3': '7.10.1',
        '@prisma/client': '7.10.1',
      },
      devDependencies: { prisma: '7.10.1' },
    }

    const updated = updatePrismaDependencies(pkg, '7.11.0', [])

    expect(updated).toBe(true)
    expect(pkg).toEqual({
      dependencies: {
        '@cedarjs/api': '7.1.0',
        '@prisma/adapter-better-sqlite3': '7.11.0',
        '@prisma/client': '7.11.0',
      },
      devDependencies: { prisma: '7.11.0' },
    })
  })

  it("doesn't add Prisma packages the project doesn't declare", () => {
    const pkg = { dependencies: { '@cedarjs/web': '7.1.0' } }

    const updated = updatePrismaDependencies(pkg, '7.11.0', [])

    expect(updated).toBe(false)
    expect(pkg).toEqual({ dependencies: { '@cedarjs/web': '7.1.0' } })
  })

  it('leaves other @prisma packages alone', () => {
    const pkg = {
      devDependencies: { '@prisma/dev': '0.25.2', prisma: '7.11.0' },
    }

    const updated = updatePrismaDependencies(pkg, '7.11.0', [])

    expect(updated).toBe(false)
    expect(pkg.devDependencies['@prisma/dev']).toBe('0.25.2')
  })

  it('only reports changes when verbose or dry run', () => {
    const quiet: string[] = []
    const loud: string[] = []

    updatePrismaDependencies(
      { devDependencies: { prisma: '7.10.1' } },
      '7.11.0',
      quiet,
    )
    updatePrismaDependencies(
      { devDependencies: { prisma: '7.10.1' } },
      '7.11.0',
      loud,
      { dryRun: true },
    )

    expect(quiet).toEqual([])
    expect(loud).toEqual([' - prisma: 7.10.1 => 7.11.0'])
  })
})

describe('addMissingDependency', () => {
  it('adds a missing package, keeping the section sorted', () => {
    const pkg = {
      dependencies: { '@cedarjs/api': '7.1.0', '@cedarjs/auth': '7.1.0' },
    }
    const messages: string[] = []

    const added = addMissingDependency(
      pkg,
      'dependencies',
      '@prisma/client',
      '7.11.0',
      messages,
    )

    expect(added).toBe(true)
    expect(Object.keys(pkg.dependencies)).toEqual([
      '@cedarjs/api',
      '@cedarjs/auth',
      '@prisma/client',
    ])
    expect(pkg.dependencies['@prisma/client']).toBe('7.11.0')
    expect(messages).toEqual([' - @prisma/client: added at 7.11.0'])
  })

  it('creates the section when the project has none', () => {
    const pkg: { devDependencies?: Record<string, string> } = {}

    addMissingDependency(pkg, 'devDependencies', 'prisma', '7.11.0', [])

    expect(pkg).toEqual({ devDependencies: { prisma: '7.11.0' } })
  })

  it("doesn't add a package the project declares in the other section", () => {
    const pkg = { dependencies: { prisma: '7.10.1' } }
    const messages: string[] = []

    const added = addMissingDependency(
      pkg,
      'devDependencies',
      'prisma',
      '7.11.0',
      messages,
    )

    expect(added).toBe(false)
    expect(pkg).toEqual({ dependencies: { prisma: '7.10.1' } })
    expect(messages).toEqual([])
  })

  it('moves a package to its section with onlyInField', () => {
    const pkg = {
      dependencies: { '@cedarjs/api': '7.1.0' },
      devDependencies: { '@prisma/client': '7.10.1', vitest: '4.1.12' },
    }
    const messages: string[] = []

    const added = addMissingDependency(
      pkg,
      'dependencies',
      '@prisma/client',
      '7.11.0',
      messages,
      { onlyInField: true },
    )

    expect(added).toBe(true)
    expect(pkg).toEqual({
      dependencies: { '@cedarjs/api': '7.1.0', '@prisma/client': '7.10.1' },
      devDependencies: { vitest: '4.1.12' },
    })
    expect(messages).toEqual([
      ' - @prisma/client: moved from devDependencies to dependencies',
    ])
  })
})

describe('fetchPrismaPeerVersion', () => {
  const packageJsonMock = vi.mocked(packageJson)

  beforeEach(() => {
    packageJsonMock.mockReset()
  })

  function stubRegistry(manifest: Record<string, unknown>) {
    packageJsonMock.mockResolvedValue(manifest)
  }

  it("returns @cedarjs/cli's prisma peer dependency version", async () => {
    stubRegistry({
      name: '@cedarjs/cli',
      peerDependencies: { prisma: '7.11.0' },
    })

    await expect(fetchPrismaPeerVersion('7.2.0')).resolves.toBe('7.11.0')
    expect(packageJsonMock).toHaveBeenCalledWith('@cedarjs/cli', {
      version: '7.2.0',
    })
  })

  it('removes build metadata from the version', async () => {
    stubRegistry({ peerDependencies: { prisma: '7.11.0' } })

    await fetchPrismaPeerVersion('7.2.0-canary.12+abc1234')

    expect(packageJsonMock).toHaveBeenCalledWith('@cedarjs/cli', {
      version: '7.2.0-canary.12',
    })
  })

  it("returns undefined when prisma isn't a peer dependency", async () => {
    stubRegistry({ dependencies: { prisma: '7.10.0' } })

    await expect(fetchPrismaPeerVersion('7.1.0')).resolves.toBeUndefined()
  })

  it('throws when the registry lookup fails', async () => {
    packageJsonMock.mockRejectedValue(
      new Error(
        'Version `99.0.0` for package `@cedarjs/cli` could not be found',
      ),
    )

    await expect(fetchPrismaPeerVersion('99.0.0')).rejects.toThrow(
      'Failed to fetch @cedarjs/cli@99.0.0 from the npm registry: ' +
        'Version `99.0.0` for package `@cedarjs/cli` could not be found',
    )
  })
})
