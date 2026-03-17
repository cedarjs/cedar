import { fs as memfs, vol } from 'memfs'
import { dedent } from 'ts-dedent'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// This is needed because of https://github.com/streamich/memfs/issues/1161
// Not using the pattern - just grabbing all files we've added to memfs
async function* memfsGlob(_pattern: string, options: { cwd: string }) {
  const entries = memfs.readdirSync(options.cwd, { recursive: true })

  for (const entry of entries) {
    // Hacky test if this is a file or directory
    if (/\.\w{2,3}$/.test(String(entry))) {
      yield entry
    }
  }
}

vi.mock('node:fs', () => {
  const mockedFs = {
    ...memfs,
    promises: {
      ...memfs.promises,
      glob: vi.fn().mockImplementation(memfsGlob),
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
        src: '/app/api/src',
        lib: '/app/api/src/lib',
        prismaConfig: '/app/api/prisma.config.cjs',
        base: '/app/api',
        dbSchema: '/app/api/db/schema.prisma',
      },
      scripts: '/app/scripts',
      base: '/app',
    }),
    getDataMigrationsPath: () => '/app/api/db/dataMigrations',
    ensurePosixPath: (path: string) => path.replace(/\\/g, '/'),
  }
})

import { rewritePrismaImportsInDirectory } from '../rewriteRemainingImports.js'

describe('rewritePrismaImportsInDirectory', () => {
  beforeEach(() => {
    vol.reset()
    vi.clearAllMocks()
  })

  it('rewrites @prisma/client imports in api/src and skips db.ts', async () => {
    vol.fromJSON({
      '/app/api/src/lib/db.ts': dedent`
        import { PrismaClient } from '@prisma/client'

        export * from '@prisma/client'

        export const db = new PrismaClient()
      `,
      '/app/api/src/services/posts/posts.ts': dedent`
        import type { Post } from '@prisma/client'

        export const posts = () => db.post.findMany()
      `,
      '/app/api/src/services/users/users.scenarios.ts': dedent`
        import type { Prisma, User } from '@prisma/client'

        export type StandardScenario = ScenarioData<User, 'user'>
      `,
      '/app/api/src/functions/noop.ts': 'export const x = 1\n',
    })

    const result = await rewritePrismaImportsInDirectory(
      '/app/api/src',
      '/app/api/src/lib/db.ts',
    )

    expect(result).toBe('updated')

    // db.ts should be untouched
    expect(memfs.readFileSync('/app/api/src/lib/db.ts', 'utf-8')).toContain(
      "from '@prisma/client'",
    )

    // posts.ts should be rewritten
    expect(memfs.readFileSync('/app/api/src/services/posts/posts.ts', 'utf-8'))
      .toBe(dedent`
      import type { Post } from 'src/lib/db'

      export const posts = () => db.post.findMany()
    `)

    // users.scenarios.ts should be rewritten
    expect(
      memfs.readFileSync(
        '/app/api/src/services/users/users.scenarios.ts',
        'utf-8',
      ),
    ).toBe(dedent`
      import type { Prisma, User } from 'src/lib/db'

      export type StandardScenario = ScenarioData<User, 'user'>
    `)

    // noop.ts has no prisma imports — should be unchanged
    expect(memfs.readFileSync('/app/api/src/functions/noop.ts', 'utf-8')).toBe(
      'export const x = 1\n',
    )
  })

  it('rewrites @prisma/client imports in scripts to api/src/lib/db', async () => {
    vol.fromJSON({
      '/app/scripts/seed.ts': dedent`
        import { PrismaClient } from '@prisma/client'

        const db = new PrismaClient()
      `,
      '/app/scripts/dataMigration.ts': dedent`
        import type { Prisma } from '@prisma/client'

        export default async () => {}
      `,
    })

    const result = await rewritePrismaImportsInDirectory('/app/scripts', null)

    expect(result).toBe('updated')

    expect(memfs.readFileSync('/app/scripts/seed.ts', 'utf-8')).toBe(
      dedent`
        import { PrismaClient } from 'api/src/lib/db'

        const db = new PrismaClient()
      `,
    )

    expect(memfs.readFileSync('/app/scripts/dataMigration.ts', 'utf-8')).toBe(
      dedent`
        import type { Prisma } from 'api/src/lib/db'

        export default async () => {}
      `,
    )
  })

  it('returns skipped when no files are found in the directory', async () => {
    // Directory is empty — memfsGlob will yield nothing
    vol.fromJSON({
      '/app/api/src/.keep': '',
    })

    // The glob yields only file-like entries; .keep has no real extension match
    // but even if it did, no prisma imports would mean 'skipped'
    // Use a completely absent directory for the clearest "no files" case
    const result = await rewritePrismaImportsInDirectory('/app/empty-dir', null)

    expect(result).toBe('skipped')
  })

  it('is safe to run when no prisma imports are present', async () => {
    vol.fromJSON({
      '/app/api/src/services/posts/posts.ts': dedent`
        import { db } from 'src/lib/db'

        export const posts = () => db.post.findMany()
      `,
    })

    const result = await rewritePrismaImportsInDirectory(
      '/app/api/src',
      '/app/api/src/lib/db.ts',
    )

    // No files were changed, so the result is 'skipped'
    expect(result).toBe('skipped')

    // File content should be completely untouched
    expect(memfs.readFileSync('/app/api/src/services/posts/posts.ts', 'utf-8'))
      .toBe(dedent`
      import { db } from 'src/lib/db'

      export const posts = () => db.post.findMany()
    `)
  })

  it('rewrites both default and type imports from @prisma/client in the same file', async () => {
    vol.fromJSON({
      '/app/api/src/services/complex/complex.ts': dedent`
        import { PrismaClient, Prisma } from '@prisma/client'
        import type { Post, User } from '@prisma/client'

        export const client = new PrismaClient()
      `,
    })

    const result = await rewritePrismaImportsInDirectory('/app/api/src', null)

    expect(result).toBe('updated')

    expect(
      memfs.readFileSync('/app/api/src/services/complex/complex.ts', 'utf-8'),
    ).toBe(dedent`
      import { PrismaClient, Prisma } from 'src/lib/db'
      import type { Post, User } from 'src/lib/db'

      export const client = new PrismaClient()
    `)
  })
})
