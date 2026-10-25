import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  fetchPrismaPeerVersion,
  updatePrismaDependencies,
} from '../upgradeHandler.js'

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

describe('fetchPrismaPeerVersion', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubRegistry(body: unknown) {
    const fetchMock = vi.fn(async () => Response.json(body))
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it("returns @cedarjs/cli's prisma peer dependency version", async () => {
    const fetchMock = stubRegistry({
      name: '@cedarjs/cli',
      peerDependencies: { prisma: '7.11.0' },
    })

    await expect(fetchPrismaPeerVersion('7.2.0')).resolves.toBe('7.11.0')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://registry.npmjs.org/@cedarjs/cli/7.2.0',
    )
  })

  it('removes build metadata from the version', async () => {
    const fetchMock = stubRegistry({ peerDependencies: { prisma: '7.11.0' } })

    await fetchPrismaPeerVersion('7.2.0-canary.12+abc1234')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://registry.npmjs.org/@cedarjs/cli/7.2.0-canary.12',
    )
  })

  it("returns undefined when prisma isn't a peer dependency", async () => {
    stubRegistry({ dependencies: { prisma: '7.10.0' } })

    await expect(fetchPrismaPeerVersion('7.1.0')).resolves.toBeUndefined()
  })

  it('throws when the registry request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('Not Found', { status: 404, statusText: 'Not Found' }),
      ),
    )

    await expect(fetchPrismaPeerVersion('99.0.0')).rejects.toThrow(
      'Failed to fetch @cedarjs/cli@99.0.0 from the npm registry: Not Found',
    )
  })
})
