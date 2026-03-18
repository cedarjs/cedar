import { fs as memfs, vol } from 'memfs'
import { dedent } from 'ts-dedent'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', () => {
  const mockedFs = {
    ...memfs,
    promises: {
      ...memfs.promises,
    },
  }

  return {
    ...mockedFs,
    default: mockedFs,
  }
})

vi.mock('@cedarjs/project-config', () => {
  return {
    getPaths: () => ({
      api: {
        dbSchema: '/app/api/db/schema.prisma',
        base: '/app/api',
        lib: '/app/api/src/lib',
        prismaConfig: '/app/api/prisma.config.cjs',
      },
      base: '/app',
    }),
    ensurePosixPath: (p: string) => p.replace(/\\/g, '/'),
  }
})

import {
  ADAPTER_PACKAGE,
  ADAPTER_VERSION,
  SQLITE_PACKAGE,
  SQLITE_VERSION,
  transformApiPackageJson,
  updateApiPackageJson,
} from '../updateApiPackageJson.js'

const MINIMAL_PACKAGE_JSON = dedent`
  {
    "name": "api",
    "version": "1.0.0",
    "dependencies": {}
  }
`

describe('transformApiPackageJson', () => {
  it('adds adapter and sqlite deps to a minimal package.json', () => {
    const result = transformApiPackageJson(MINIMAL_PACKAGE_JSON)
    const parsed = JSON.parse(result) as {
      dependencies: Record<string, string>
    }

    expect(parsed.dependencies[ADAPTER_PACKAGE]).toBe(ADAPTER_VERSION)
    expect(parsed.dependencies[SQLITE_PACKAGE]).toBe(SQLITE_VERSION)
  })

  it('is idempotent when the adapter is already present', () => {
    const alreadyHasAdapter =
      JSON.stringify(
        {
          name: 'api',
          version: '1.0.0',
          dependencies: {
            [ADAPTER_PACKAGE]: ADAPTER_VERSION,
            [SQLITE_PACKAGE]: SQLITE_VERSION,
          },
        },
        null,
        2,
      ) + '\n'

    const result = transformApiPackageJson(alreadyHasAdapter)

    expect(result).toBe(alreadyHasAdapter)
  })

  it('preserves existing dependencies when adding the new ones', () => {
    const withExistingDeps =
      JSON.stringify(
        {
          name: 'api',
          version: '1.0.0',
          dependencies: {
            '@cedarjs/api': '^3.0.0',
            express: '^4.18.0',
          },
        },
        null,
        2,
      ) + '\n'

    const result = transformApiPackageJson(withExistingDeps)
    const parsed = JSON.parse(result) as {
      dependencies: Record<string, string>
    }

    expect(parsed.dependencies['@cedarjs/api']).toBe('^3.0.0')
    expect(parsed.dependencies['express']).toBe('^4.18.0')
    expect(parsed.dependencies[ADAPTER_PACKAGE]).toBe(ADAPTER_VERSION)
    expect(parsed.dependencies[SQLITE_PACKAGE]).toBe(SQLITE_VERSION)
  })

  it('adds a dependencies block when none exists', () => {
    const noDeps =
      JSON.stringify(
        {
          name: 'api',
          version: '1.0.0',
        },
        null,
        2,
      ) + '\n'

    const result = transformApiPackageJson(noDeps)
    const parsed = JSON.parse(result) as {
      dependencies: Record<string, string>
    }

    expect(parsed.dependencies[ADAPTER_PACKAGE]).toBe(ADAPTER_VERSION)
    expect(parsed.dependencies[SQLITE_PACKAGE]).toBe(SQLITE_VERSION)
  })

  it('respects custom version overrides', () => {
    const result = transformApiPackageJson(
      MINIMAL_PACKAGE_JSON,
      '^7.1.0',
      '^12.1.0',
    )
    const parsed = JSON.parse(result) as {
      dependencies: Record<string, string>
    }

    expect(parsed.dependencies[ADAPTER_PACKAGE]).toBe('^7.1.0')
    expect(parsed.dependencies[SQLITE_PACKAGE]).toBe('^12.1.0')
  })
})

describe('updateApiPackageJson (fs-level)', () => {
  beforeEach(() => {
    vol.reset()
    vi.clearAllMocks()
  })

  it('skips when file does not exist', async () => {
    const result = await updateApiPackageJson('/app/api/package.json')

    expect(result).toBe('skipped')
  })

  it('writes the file when the adapter is not yet present', async () => {
    vol.fromJSON({
      '/app/api/package.json': MINIMAL_PACKAGE_JSON,
    })

    const result = await updateApiPackageJson('/app/api/package.json')

    expect(result).toBe('updated')

    const written = memfs.readFileSync(
      '/app/api/package.json',
      'utf-8',
    ) as string
    const parsed = JSON.parse(written) as {
      dependencies: Record<string, string>
    }

    expect(parsed.dependencies[ADAPTER_PACKAGE]).toBe(ADAPTER_VERSION)
    expect(parsed.dependencies[SQLITE_PACKAGE]).toBe(SQLITE_VERSION)
  })

  it('returns unmodified and does not rewrite when adapter already present', async () => {
    const alreadyMigrated =
      JSON.stringify(
        {
          name: 'api',
          version: '1.0.0',
          dependencies: {
            [ADAPTER_PACKAGE]: ADAPTER_VERSION,
            [SQLITE_PACKAGE]: SQLITE_VERSION,
          },
        },
        null,
        2,
      ) + '\n'

    vol.fromJSON({
      '/app/api/package.json': alreadyMigrated,
    })

    const result = await updateApiPackageJson('/app/api/package.json')

    expect(result).toBe('unmodified')

    const written = memfs.readFileSync(
      '/app/api/package.json',
      'utf-8',
    ) as string

    expect(written).toBe(alreadyMigrated)
  })
})
