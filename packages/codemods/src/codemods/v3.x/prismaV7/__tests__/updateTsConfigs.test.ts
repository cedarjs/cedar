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
      web: {
        base: '/app/web',
      },
      scripts: '/app/scripts',
    }),
    ensurePosixPath: (p: string) => p.replace(/\\/g, '/'),
  }
})

import { transformTsConfig, updateTsConfigs } from '../updateTsConfigs.js'

const TSCONFIG_WITH_MODULE_RESOLUTION = dedent`
  {
    "compilerOptions": {
      "target": "es2023",
      "module": "node20",
      "moduleResolution": "node16",
      "skipLibCheck": false
    }
  }
`

const TSCONFIG_WITH_MODULE_ONLY = dedent`
  {
    "compilerOptions": {
      "target": "es2023",
      "module": "node20",
      "skipLibCheck": false
    }
  }
`

const TSCONFIG_ALREADY_MIGRATED = dedent`
  {
    "compilerOptions": {
      "target": "es2023",
      "module": "node20",
      "moduleResolution": "node16",
      "allowImportingTsExtensions": true,
      "skipLibCheck": false
    }
  }
`

describe('transformTsConfig', () => {
  it('inserts allowImportingTsExtensions after moduleResolution', () => {
    const result = transformTsConfig(TSCONFIG_WITH_MODULE_RESOLUTION)

    expect(result).toContain('"allowImportingTsExtensions": true')

    // Verify ordering: allowImportingTsExtensions comes right after moduleResolution
    const moduleResolutionIndex = result.indexOf('"moduleResolution"')
    const allowImportingIndex = result.indexOf('"allowImportingTsExtensions"')

    expect(allowImportingIndex).toBeGreaterThan(moduleResolutionIndex)

    // skipLibCheck should still come after allowImportingTsExtensions
    const skipLibCheckIndex = result.indexOf('"skipLibCheck"')

    expect(skipLibCheckIndex).toBeGreaterThan(allowImportingIndex)
  })

  it('produces the exact expected output when moduleResolution is present', () => {
    const expected = dedent`
      {
        "compilerOptions": {
          "target": "es2023",
          "module": "node20",
          "moduleResolution": "node16",
          "allowImportingTsExtensions": true,
          "skipLibCheck": false
        }
      }
    `

    const result = transformTsConfig(TSCONFIG_WITH_MODULE_RESOLUTION)

    expect(result).toBe(expected)
  })

  it('inserts allowImportingTsExtensions after module when moduleResolution is absent', () => {
    const result = transformTsConfig(TSCONFIG_WITH_MODULE_ONLY)

    expect(result).toContain('"allowImportingTsExtensions": true')

    const moduleIndex = result.indexOf('"module"')
    const allowImportingIndex = result.indexOf('"allowImportingTsExtensions"')
    const skipLibCheckIndex = result.indexOf('"skipLibCheck"')

    expect(allowImportingIndex).toBeGreaterThan(moduleIndex)
    expect(skipLibCheckIndex).toBeGreaterThan(allowImportingIndex)
  })

  it('is idempotent when allowImportingTsExtensions is already present', () => {
    const result = transformTsConfig(TSCONFIG_ALREADY_MIGRATED)

    expect(result).toBe(TSCONFIG_ALREADY_MIGRATED)

    // Should not duplicate the key
    const occurrences = (result.match(/"allowImportingTsExtensions"/g) ?? [])
      .length

    expect(occurrences).toBe(1)
  })

  it('handles a tsconfig with only compilerOptions and no module/moduleResolution', () => {
    const minimal = dedent`
      {
        "compilerOptions": {
          "skipLibCheck": false
        }
      }
    `

    const result = transformTsConfig(minimal)

    expect(result).toContain('"allowImportingTsExtensions": true')
  })
})

describe('updateTsConfigs (fs-level)', () => {
  beforeEach(() => {
    vol.reset()
    vi.clearAllMocks()
  })

  it('updates all three tsconfig files', async () => {
    vol.fromJSON({
      '/app/api/tsconfig.json': TSCONFIG_WITH_MODULE_RESOLUTION,
      '/app/scripts/tsconfig.json': TSCONFIG_WITH_MODULE_RESOLUTION,
      '/app/web/tsconfig.json': TSCONFIG_WITH_MODULE_RESOLUTION,
    })

    const result = await updateTsConfigs({
      apiTsConfig: '/app/api/tsconfig.json',
      scriptsTsConfig: '/app/scripts/tsconfig.json',
      webTsConfig: '/app/web/tsconfig.json',
    })

    expect(result.api).toBe('updated')
    expect(result.scripts).toBe('updated')
    expect(result.web).toBe('updated')

    for (const filePath of [
      '/app/api/tsconfig.json',
      '/app/scripts/tsconfig.json',
      '/app/web/tsconfig.json',
    ]) {
      const written = memfs.readFileSync(filePath, 'utf-8') as string

      expect(written).toContain('"allowImportingTsExtensions": true')
    }
  })

  it('returns skipped for tsconfig files that do not exist', async () => {
    const result = await updateTsConfigs({
      apiTsConfig: '/app/api/tsconfig.json',
      scriptsTsConfig: '/app/scripts/tsconfig.json',
      webTsConfig: '/app/web/tsconfig.json',
    })

    expect(result.api).toBe('skipped')
    expect(result.scripts).toBe('skipped')
    expect(result.web).toBe('skipped')
  })

  it('returns unmodified for already-migrated tsconfig files', async () => {
    vol.fromJSON({
      '/app/api/tsconfig.json': TSCONFIG_ALREADY_MIGRATED,
      '/app/scripts/tsconfig.json': TSCONFIG_ALREADY_MIGRATED,
      '/app/web/tsconfig.json': TSCONFIG_ALREADY_MIGRATED,
    })

    const result = await updateTsConfigs({
      apiTsConfig: '/app/api/tsconfig.json',
      scriptsTsConfig: '/app/scripts/tsconfig.json',
      webTsConfig: '/app/web/tsconfig.json',
    })

    expect(result.api).toBe('unmodified')
    expect(result.scripts).toBe('unmodified')
    expect(result.web).toBe('unmodified')
  })

  it('handles a mix of present, missing, and already-migrated files', async () => {
    vol.fromJSON({
      '/app/api/tsconfig.json': TSCONFIG_WITH_MODULE_RESOLUTION,
      '/app/web/tsconfig.json': TSCONFIG_ALREADY_MIGRATED,
      // scripts tsconfig intentionally absent
    })

    const result = await updateTsConfigs({
      apiTsConfig: '/app/api/tsconfig.json',
      scriptsTsConfig: '/app/scripts/tsconfig.json',
      webTsConfig: '/app/web/tsconfig.json',
    })

    expect(result.api).toBe('updated')
    expect(result.scripts).toBe('skipped')
    expect(result.web).toBe('unmodified')
  })
})
