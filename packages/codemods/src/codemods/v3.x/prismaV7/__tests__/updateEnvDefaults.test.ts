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
  checkDotEnv,
  transformEnvDefaults,
  updateEnvDefaults,
} from '../updateEnvDefaults.js'

describe('transformEnvDefaults', () => {
  it('updates old SQLite URL', () => {
    const source = 'DATABASE_URL=file:./dev.db\n'
    const result = transformEnvDefaults(source)

    expect(result).toBe('DATABASE_URL=file:./db/dev.db\n')
  })

  it('leaves PostgreSQL URL unchanged', () => {
    const source = 'DATABASE_URL=postgresql://localhost/mydb\n'
    const result = transformEnvDefaults(source)

    expect(result).toBe(source)
  })

  it('leaves new SQLite URL unchanged', () => {
    const source = 'DATABASE_URL=file:./db/dev.db\n'
    const result = transformEnvDefaults(source)

    expect(result).toBe(source)
  })

  it('is idempotent when already using new path', () => {
    const source =
      dedent`
      DATABASE_URL=file:./db/dev.db
      OTHER_VAR=something
    ` + '\n'

    const result = transformEnvDefaults(source)

    expect(result).toBe(source)
  })

  it('only replaces the DATABASE_URL line and leaves other lines intact', () => {
    const source =
      dedent`
      SOME_VAR=foo
      DATABASE_URL=file:./dev.db
      ANOTHER_VAR=bar
    ` + '\n'

    const result = transformEnvDefaults(source)

    expect(result).toContain('DATABASE_URL=file:./db/dev.db')
    expect(result).toContain('SOME_VAR=foo')
    expect(result).toContain('ANOTHER_VAR=bar')
    expect(result).not.toContain('DATABASE_URL=file:./dev.db')
  })

  it('does not modify a URL that merely contains the old path as a substring', () => {
    const source = 'DATABASE_URL=file:./dev.db.bak\n'
    const result = transformEnvDefaults(source)

    // The regex only matches the exact old value so the .bak variant is untouched
    expect(result).toBe(source)
  })
})

describe('checkDotEnv', () => {
  beforeEach(() => {
    vol.reset()
    vi.clearAllMocks()
  })

  it('returns a warning string when the old SQLite path is found', () => {
    vol.fromJSON({
      '/app/.env': 'DATABASE_URL=file:./dev.db\n',
    })

    const warning = checkDotEnv('/app/.env')

    expect(warning).not.toBeNull()
    expect(warning).toContain('DATABASE_URL=file:./dev.db')
    expect(warning).toContain('file:./db/dev.db')
  })

  it('returns null when the new SQLite path is already used', () => {
    vol.fromJSON({
      '/app/.env': 'DATABASE_URL=file:./db/dev.db\n',
    })

    const warning = checkDotEnv('/app/.env')

    expect(warning).toBeNull()
  })

  it('returns null when the .env file does not exist', () => {
    const warning = checkDotEnv('/app/.env')

    expect(warning).toBeNull()
  })

  it('returns null for a PostgreSQL URL', () => {
    vol.fromJSON({
      '/app/.env': 'DATABASE_URL=postgresql://localhost/mydb\n',
    })

    const warning = checkDotEnv('/app/.env')

    expect(warning).toBeNull()
  })
})

describe('updateEnvDefaults (fs-level)', () => {
  beforeEach(() => {
    vol.reset()
    vi.clearAllMocks()
  })

  it('skips when file does not exist', async () => {
    const result = await updateEnvDefaults('/app/.env.defaults')

    expect(result).toBe('skipped')
  })

  it('updates the file when the old SQLite URL is present', async () => {
    vol.fromJSON({
      '/app/.env.defaults': 'DATABASE_URL=file:./dev.db\n',
    })

    const result = await updateEnvDefaults('/app/.env.defaults')

    expect(result).toBe('updated')

    const written = memfs.readFileSync('/app/.env.defaults', 'utf-8') as string

    expect(written).toBe('DATABASE_URL=file:./db/dev.db\n')
  })

  it('returns unmodified when the file already has the new SQLite URL', async () => {
    vol.fromJSON({
      '/app/.env.defaults': 'DATABASE_URL=file:./db/dev.db\n',
    })

    const result = await updateEnvDefaults('/app/.env.defaults')

    expect(result).toBe('unmodified')
  })

  it('returns unmodified for a PostgreSQL URL', async () => {
    vol.fromJSON({
      '/app/.env.defaults': 'DATABASE_URL=postgresql://localhost/mydb\n',
    })

    const result = await updateEnvDefaults('/app/.env.defaults')

    expect(result).toBe('unmodified')
  })
})
