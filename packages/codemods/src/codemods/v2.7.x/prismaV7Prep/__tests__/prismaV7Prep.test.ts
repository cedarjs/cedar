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
// TODO: Just do this when https://github.com/streamich/memfs/pull/1162 is
// merged
// vi.mock('node:fs', async () => ({ ...memfs, default: memfs }))

vi.mock('@cedarjs/project-config', () => {
  return {
    getPaths: () => ({
      api: {
        src: '/app/api/src',
        lib: '/app/api/src/lib',
        prismaConfig: '/app/api/prisma.config.cjs',
      },
      scripts: '/app/scripts',
    }),
    getDataMigrationsPath: () => '/app/api/db/dataMigrations',
  }
})

import prismaV7Prep, {
  rewritePrismaImportsInDirectory,
  updateDbFile,
} from '../prismaV7Prep'

describe('prismaV7Prep', () => {
  beforeEach(() => {
    vol.reset()
    vi.clearAllMocks()
  })

  it('adds the Prisma re-export in db.ts after the Prisma import', async () => {
    vol.fromJSON({
      '/app/api/src/lib/db.ts': dedent`
        import { PrismaClient } from '@prisma/client'

        export const db = new PrismaClient()
      `,
    })

    await updateDbFile('/app/api/src/lib/db.ts')

    expect(memfs.readFileSync('/app/api/src/lib/db.ts', 'utf-8')).toBe(
      dedent`
        import { PrismaClient } from '@prisma/client'

        export * from '@prisma/client'

        export const db = new PrismaClient()
      `,
    )
  })

  it('does not duplicate an existing Prisma re-export in db.js', async () => {
    vol.fromJSON({
      '/app/api/src/lib/db.js': dedent`
         import { PrismaClient } from '@prisma/client'

         export * from '@prisma/client'

         export const db = new PrismaClient()
      `,
    })

    const result = await updateDbFile('/app/api/src/lib/db.js')

    expect(result).toBe('unmodified')
    expect(memfs.readFileSync('/app/api/src/lib/db.js', 'utf-8')).toBe(
      dedent`
        import { PrismaClient } from '@prisma/client'

        export * from '@prisma/client'

        export const db = new PrismaClient()
      `,
    )
  })

  it('rewrites Prisma imports in api/src and skips db.ts', async () => {
    vol.fromJSON({
      '/app/api/src/lib/db.ts': dedent`
        import { PrismaClient } from '@prisma/client'

        export const db = new PrismaClient()
      `,
      '/app/api/src/services/posts/posts.scenarios.ts': dedent`
        import type { Prisma, Post } from '@prisma/client'

        export type StandardScenario = ScenarioData<Post, 'post'>
      `,
      '/app/api/src/services/users/noop.ts': 'export const x = 1\n',
    })

    const result = await rewritePrismaImportsInDirectory(
      '/app/api/src',
      '/app/api/src/lib/db.ts',
    )

    expect(result).toEqual('updated')

    expect(
      memfs.readFileSync(
        '/app/api/src/services/posts/posts.scenarios.ts',
        'utf-8',
      ),
    ).toBe(
      dedent`
        import type { Prisma, Post } from 'src/lib/db'

        export type StandardScenario = ScenarioData<Post, 'post'>
      `,
    )
    expect(memfs.readFileSync('/app/api/src/lib/db.ts', 'utf-8')).toBe(
      dedent`
        import { PrismaClient } from '@prisma/client'

        export const db = new PrismaClient()
      `,
    )
  })

  it('rewrites Prisma imports in scripts to api/src/lib/db', async () => {
    vol.fromJSON({
      '/app/scripts/seed.ts': dedent`
          import { PrismaClient } from '@prisma/client'

          const db = new PrismaClient()
        `,
    })

    const result = await rewritePrismaImportsInDirectory('/app/scripts', null)

    expect(result).toEqual('updated')
    expect(memfs.readFileSync('/app/scripts/seed.ts', 'utf-8')).toBe(
      dedent`
        import { PrismaClient } from 'api/src/lib/db'

        const db = new PrismaClient()
      `,
    )
  })

  it('runs end-to-end over api/src, dataMigrations, and scripts', async () => {
    vol.fromJSON({
      '/app/api/src/lib/db.ts': dedent`
          import { PrismaClient } from '@prisma/client'

          export const db = new PrismaClient()
        `,
      '/app/api/src/functions/graphql.ts': dedent`
        import type { PrismaClient } from '@prisma/client'

        export const dbType = null as unknown as PrismaClient
      `,
      '/app/api/db/dataMigrations/20260101000000-add-post-slug.ts': dedent`
        import { PrismaClient } from '@prisma/client'

        export default async () => new PrismaClient()
      `,
      '/app/scripts/seed.ts': dedent`
        import { PrismaClient } from '@prisma/client'

        export default new PrismaClient()
      `,
    })

    await prismaV7Prep()

    expect(memfs.readFileSync('/app/api/src/lib/db.ts', 'utf-8')).toContain(
      "export * from '@prisma/client'",
    )
    expect(
      memfs.readFileSync('/app/api/src/functions/graphql.ts', 'utf-8'),
    ).toContain("from 'src/lib/db'")
    expect(
      memfs.readFileSync(
        '/app/api/db/dataMigrations/20260101000000-add-post-slug.ts',
        'utf-8',
      ),
    ).toContain("from 'src/lib/db'")
    expect(memfs.readFileSync('/app/scripts/seed.ts', 'utf-8')).toContain(
      "from 'api/src/lib/db'",
    )
  })
})
