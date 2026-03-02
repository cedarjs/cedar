import path from 'node:path'

import { fs as memfs, vol } from 'memfs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const projectConfigMock = vi.hoisted(() => ({
  getPaths: vi.fn(),
  getDataMigrationsPath: vi.fn(),
}))

vi.mock('node:fs', () => {
  const codeExtensions = new Set([
    '.ts',
    '.tsx',
    '.cts',
    '.mts',
    '.js',
    '.jsx',
    '.cjs',
    '.mjs',
  ])

  const glob = async function* (
    _pattern: string,
    options: { cwd?: string } = {},
  ) {
    const cwd = options.cwd || '/'

    if (!memfs.existsSync(cwd)) {
      const error = Object.assign(
        new Error(`ENOENT: no such file or directory, scandir '${cwd}'`),
        { code: 'ENOENT' },
      )
      throw error
    }

    const matches: string[] = []

    const walk = (relativePath = '') => {
      const currentPath = relativePath ? path.join(cwd, relativePath) : cwd
      const entries = memfs.readdirSync(currentPath, { withFileTypes: true })

      for (const entry of entries) {
        const childRelativePath = relativePath
          ? path.join(relativePath, entry.name)
          : entry.name

        if (entry.isDirectory()) {
          walk(childRelativePath)
          continue
        }

        if (codeExtensions.has(path.extname(entry.name))) {
          matches.push(childRelativePath)
        }
      }
    }

    walk()

    for (const match of matches) {
      yield match
    }
  }

  const mockedFs = {
    ...memfs,
    promises: {
      ...memfs.promises,
      glob,
    },
  }

  return {
    ...mockedFs,
    default: mockedFs,
  }
})

vi.mock('@cedarjs/project-config', () => projectConfigMock)

import prismaV7Prep, {
  rewritePrismaImportsInDirectory,
  updateDbFile,
} from '../prismaV7Prep'

describe('prismaV7Prep', () => {
  beforeEach(() => {
    vol.reset()
    vi.clearAllMocks()

    projectConfigMock.getPaths.mockReturnValue({
      api: {
        src: '/app/api/src',
        lib: '/app/api/src/lib',
        prismaConfig: '/app/api/prisma.config.cjs',
      },
      scripts: '/app/scripts',
    })
    projectConfigMock.getDataMigrationsPath.mockResolvedValue(
      '/app/api/db/dataMigrations',
    )
  })

  it('adds the Prisma re-export in db.ts after the Prisma import', async () => {
    vol.fromJSON({
      '/app/api/src/lib/db.ts':
        "import { PrismaClient } from '@prisma/client'\n\nexport const db = new PrismaClient()\n",
    })

    await updateDbFile('/app/api/src/lib/db.ts')

    expect(memfs.readFileSync('/app/api/src/lib/db.ts', 'utf-8')).toBe(
      "import { PrismaClient } from '@prisma/client'\n\nexport * from '@prisma/client'\n\nexport const db = new PrismaClient()\n",
    )
  })

  it('does not duplicate an existing Prisma re-export in db.js', async () => {
    vol.fromJSON({
      '/app/api/src/lib/db.js':
        "import { PrismaClient } from '@prisma/client'\n\nexport * from '@prisma/client'\n\nexport const db = new PrismaClient()\n",
    })

    const result = await updateDbFile('/app/api/src/lib/db.js')

    expect(result).toBe('unmodified')
    expect(memfs.readFileSync('/app/api/src/lib/db.js', 'utf-8')).toBe(
      "import { PrismaClient } from '@prisma/client'\n\nexport * from '@prisma/client'\n\nexport const db = new PrismaClient()\n",
    )
  })

  it('rewrites Prisma imports in api/src and skips db.ts', async () => {
    vol.fromJSON({
      '/app/api/src/lib/db.ts':
        "import { PrismaClient } from '@prisma/client'\n\nexport const db = new PrismaClient()\n",
      '/app/api/src/services/posts/posts.scenarios.ts':
        "import type { Prisma, Post } from '@prisma/client'\n\nexport type StandardScenario = ScenarioData<Post, 'post'>\n",
      '/app/api/src/services/users/noop.ts': 'export const x = 1\n',
    })

    const result = await rewritePrismaImportsInDirectory(
      '/app/api/src',
      '/app/api/src/lib/db.ts',
    )

    expect(result).not.toEqual('skipped')
    expect(
      memfs.readFileSync(
        '/app/api/src/services/posts/posts.scenarios.ts',
        'utf-8',
      ),
    ).toBe(
      "import type { Prisma, Post } from 'src/lib/db'\n\nexport type StandardScenario = ScenarioData<Post, 'post'>\n",
    )
    expect(memfs.readFileSync('/app/api/src/lib/db.ts', 'utf-8')).toBe(
      "import { PrismaClient } from '@prisma/client'\n\nexport const db = new PrismaClient()\n",
    )
  })

  it('rewrites Prisma imports in scripts to api/src/lib/db', async () => {
    vol.fromJSON({
      '/app/scripts/seed.ts':
        "import { PrismaClient } from '@prisma/client'\n\nconst db = new PrismaClient()\n",
    })

    const result = await rewritePrismaImportsInDirectory('/app/scripts', null)

    expect(result).not.toEqual('skipped')
    expect(memfs.readFileSync('/app/scripts/seed.ts', 'utf-8')).toBe(
      "import { PrismaClient } from 'api/src/lib/db'\n\nconst db = new PrismaClient()\n",
    )
  })

  it('runs end-to-end over api/src, dataMigrations, and scripts', async () => {
    vol.fromJSON({
      '/app/api/src/lib/db.ts':
        "import { PrismaClient } from '@prisma/client'\n\nexport const db = new PrismaClient()\n",
      '/app/api/src/functions/graphql.ts':
        "import type { PrismaClient } from '@prisma/client'\n\nexport const dbType = null as unknown as PrismaClient\n",
      '/app/api/db/dataMigrations/20260101000000-add-post-slug.ts':
        "import { PrismaClient } from '@prisma/client'\n\nexport default async () => new PrismaClient()\n",
      '/app/scripts/seed.ts':
        "import { PrismaClient } from '@prisma/client'\n\nexport default new PrismaClient()\n",
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
