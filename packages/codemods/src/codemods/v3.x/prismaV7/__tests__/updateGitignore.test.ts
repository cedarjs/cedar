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

import { transformGitignore, updateGitignore } from '../updateGitignore.js'

const ENTRY = 'api/db/generated/prisma'

describe('transformGitignore', () => {
  it('inserts entry after dev.db* line', () => {
    const source =
      dedent`
      node_modules
      .env
      dev.db*
      dist
    ` + '\n'

    const result = transformGitignore(source)

    expect(result).toContain(ENTRY)

    const lines = result.split('\n')
    const devDbIndex = lines.findIndex((l) => l === 'dev.db*')
    const entryIndex = lines.findIndex((l) => l === ENTRY)

    expect(entryIndex).toBe(devDbIndex + 1)
  })

  it('appends entry at end when dev.db* line is not present', () => {
    const source =
      dedent`
      node_modules
      .env
      dist
    ` + '\n'

    const result = transformGitignore(source)

    expect(result).toContain(ENTRY)

    // Entry should be at the end (last non-empty line)
    const lines = result.split('\n').filter((l) => l.trim() !== '')
    expect(lines[lines.length - 1]).toBe(ENTRY)
  })

  it('appends a trailing newline when the source has none', () => {
    const source = 'node_modules\n.env'

    const result = transformGitignore(source)

    expect(result.endsWith('\n')).toBe(true)
    expect(result).toContain(ENTRY)
  })

  it('is idempotent when entry is already present', () => {
    const source =
      dedent`
      node_modules
      dev.db*
      api/db/generated/prisma
      dist
    ` + '\n'

    const result = transformGitignore(source)

    expect(result).toBe(source)

    // Should not duplicate the entry
    const occurrences = (result.match(/api\/db\/generated\/prisma/g) ?? [])
      .length
    expect(occurrences).toBe(1)
  })

  it('preserves all other lines in the file', () => {
    const source =
      dedent`
      node_modules
      .env
      dev.db*
      dist
      .DS_Store
    ` + '\n'

    const result = transformGitignore(source)

    expect(result).toContain('node_modules')
    expect(result).toContain('.env')
    expect(result).toContain('dev.db*')
    expect(result).toContain('dist')
    expect(result).toContain('.DS_Store')
  })
})

describe('updateGitignore (fs-level)', () => {
  beforeEach(() => {
    vol.reset()
    vi.clearAllMocks()
  })

  it('skips when file does not exist', async () => {
    const result = await updateGitignore('/app/.gitignore')

    expect(result).toBe('skipped')
  })

  it('writes the file when dev.db* is present and entry is missing', async () => {
    vol.fromJSON({
      '/app/.gitignore':
        dedent`
        node_modules
        .env
        dev.db*
        dist
      ` + '\n',
    })

    const result = await updateGitignore('/app/.gitignore')

    expect(result).toBe('updated')

    const written = memfs.readFileSync('/app/.gitignore', 'utf-8') as string

    expect(written).toContain(ENTRY)

    const lines = written.split('\n')
    const devDbIndex = lines.findIndex((l) => l === 'dev.db*')
    const entryIndex = lines.findIndex((l) => l === ENTRY)

    expect(entryIndex).toBe(devDbIndex + 1)
  })

  it('writes the file when dev.db* is absent and entry needs appending', async () => {
    vol.fromJSON({
      '/app/.gitignore':
        dedent`
        node_modules
        .env
        dist
      ` + '\n',
    })

    const result = await updateGitignore('/app/.gitignore')

    expect(result).toBe('updated')

    const written = memfs.readFileSync('/app/.gitignore', 'utf-8') as string

    expect(written).toContain(ENTRY)
  })

  it('returns unmodified when entry is already present', async () => {
    const alreadyMigrated =
      dedent`
      node_modules
      .env
      dev.db*
      api/db/generated/prisma
      dist
    ` + '\n'

    vol.fromJSON({
      '/app/.gitignore': alreadyMigrated,
    })

    const result = await updateGitignore('/app/.gitignore')

    expect(result).toBe('unmodified')

    const written = memfs.readFileSync('/app/.gitignore', 'utf-8') as string

    expect(written).toBe(alreadyMigrated)
  })
})
