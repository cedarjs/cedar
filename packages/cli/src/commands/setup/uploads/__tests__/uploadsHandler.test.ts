vi.mock('node:fs')

import '../../../../lib/mockTelemetry'

import type * as NodeFs from 'node:fs'
import path from 'node:path'

import { vol, fs as memfsFs } from 'memfs'
import { dedent } from 'ts-dedent'
import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  beforeAll,
  afterAll,
} from 'vitest'

import type * as ProjectConfig from '@cedarjs/project-config'

import { Listr2Mock } from '../../../../__tests__/Listr2Mock.js'
import { UPLOADS_GITIGNORE_ENTRY } from '../gitignore.js'
import * as uploadsHandler from '../uploadsHandler.js'

vi.mock('node:fs', async () => ({ ...memfsFs, default: { ...memfsFs } }))

vi.mock('@cedarjs/cli-helpers/colors', () => ({
  colors: Object.fromEntries(
    [
      'error',
      'warning',
      'highlight',
      'success',
      'info',
      'bold',
      'underline',
      'note',
      'tip',
      'important',
      'caution',
      'link',
    ].map((k) => [k, (s) => s]),
  ),
}))

vi.mock('@cedarjs/cli-helpers/installHelpers', () => ({
  addApiPackages: () => ({
    title: 'Adding required api packages...',
    task: async () => {},
  }),
  addWebPackages: () => ({
    title: 'Adding required web packages...',
    task: async () => {},
  }),
}))

vi.mock('@cedarjs/cli-helpers/packageManager/display', () => ({
  formatCedarCommand: (args: string[] = []) => `yarn cedar ${args.join(' ')}`,
  formatInstallCommand: () => 'yarn install',
}))

// The handler reads `package.json` through a dynamic native import, which memfs
// cannot serve — so the base path points at a real temporary directory holding
// that one file, while the remaining project files live in memfs at the same path.
const { BASE_PATH, removeBasePath } = vi.hoisted(() => {
  const { mkdtempSync, writeFileSync, rmSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')

  const basePath = mkdtempSync(join(tmpdir(), 'cedar-uploads-handler-test-'))
  writeFileSync(
    join(basePath, 'package.json'),
    JSON.stringify({ devDependencies: { '@cedarjs/core': '1.0.0' } }),
  )
  return {
    BASE_PATH: basePath,
    removeBasePath: () => rmSync(basePath, { recursive: true, force: true }),
  }
})

vi.mock('@cedarjs/project-config', async (importOriginal) => {
  const path = await import('node:path')
  const originalProjectConfig = await importOriginal<typeof ProjectConfig>()

  return {
    ...originalProjectConfig,
    getPaths: () => ({
      base: BASE_PATH,
      api: {
        base: path.join(BASE_PATH, 'api'),
        src: path.join(BASE_PATH, 'api', 'src'),
        lib: path.join(BASE_PATH, 'api', 'src', 'lib'),
        graphql: path.join(BASE_PATH, 'api', 'src', 'graphql'),
        services: path.join(BASE_PATH, 'api', 'src', 'services'),
        functions: path.join(BASE_PATH, 'api', 'src', 'functions'),
        directives: path.join(BASE_PATH, 'api', 'src', 'directives'),
        prismaConfig: path.join(BASE_PATH, 'api', 'prisma.config.cjs'),
      },
      web: {
        base: path.join(BASE_PATH, 'web'),
      },
    }),
    getSchemaPath: () => path.join(BASE_PATH, 'api', 'db', 'schema.prisma'),
    getPrismaSchemas: async () => ({
      schemas: [],
    }),
  }
})

vi.mock('../../server-file/serverFileHandler.js', () => ({
  setupServerFileTasks: () => [
    {
      title: 'Adding the server file...',
      task: async () => {},
    },
  ],
}))

vi.mock('listr2', () => ({
  Listr: Listr2Mock,
}))

beforeAll(() => {
  vi.spyOn(console, 'log')
  vi.spyOn(console, 'error').mockImplementation((...args) => {
    // Surface the handler's failure message in the test output instead of
    // swallowing it: the catch-all in uploadsHandler prints the reason before
    // calling process.exit, which is the only clue when a task throws.
    process.stdout.write(
      `[console.error] ${args.map((a) => String(a)).join(' ')}\n`,
    )
  })
})

afterAll(() => {
  vi.mocked(console).log.mockRestore?.()
  vi.mocked(console).error.mockRestore?.()

  removeBasePath()
})

// The handler reads its template files through the mocked `node:fs`, so the
// real template contents are seeded into memfs under their real source-tree
// paths.
const TEMPLATE_DIR = path.join(import.meta.dirname, '..', 'templates')
const actualFs = await vi.importActual<typeof NodeFs>('node:fs')
const templates = Object.fromEntries(
  actualFs
    .readdirSync(TEMPLATE_DIR)
    .map((file) => [
      path.join(TEMPLATE_DIR, file),
      actualFs.readFileSync(path.join(TEMPLATE_DIR, file), 'utf-8'),
    ]),
)

const SERVER = dedent`
  import { createServer } from '@cedarjs/api-server'

  async function main() {
    const server = await createServer({})

    await server.start()
  }

  main()
`

const GITIGNORE = dedent`
  .DS_Store
  .env*
  dev.db*
  dist
  node_modules
`

beforeEach(() => {
  vol.reset()
  vol.fromJSON(
    {
      ...templates,
      'package.json': JSON.stringify({
        devDependencies: { '@cedarjs/core': '1.0.0' },
      }),
      'api/tsconfig.json': '',
      'api/db/schema.prisma': 'datasource db {\n  provider = "sqlite"\n}\n',
      '.gitignore': `${GITIGNORE}\n`,
      'api/src/lib': null,
      'api/src/graphql': null,
      'api/src/services/uploads': null,
      'api/src/functions/graphql.ts': '',
      'api/src/server.ts': `${SERVER}\n`,
    },
    BASE_PATH,
  )
})

describe('uploadsHandler', () => {
  it('writes the upload directory entry to .gitignore for the fs target', async () => {
    await uploadsHandler.handler({ targets: ['fs'], force: false })

    expect(Listr2Mock.executedTaskTitles).toContain(
      'Adding the fs upload directory to .gitignore...',
    )

    const gitignore = vol.readFileSync(
      path.join(BASE_PATH, '.gitignore'),
      'utf-8',
    )
    expect(gitignore).toBe(dedent`
      .DS_Store
      .env*
      dev.db*
      ${UPLOADS_GITIGNORE_ENTRY}
      dist
      node_modules\n
    `)
  })

  it('creates .gitignore when it does not exist', async () => {
    vol.rmSync(path.join(BASE_PATH, '.gitignore'), { force: true })

    await uploadsHandler.handler({ targets: ['fs'], force: false })

    const gitignore = vol.readFileSync(
      path.join(BASE_PATH, '.gitignore'),
      'utf-8',
    )
    expect(gitignore).toBe(`${UPLOADS_GITIGNORE_ENTRY}\n`)
  })

  it('skips the .gitignore task when the fs target is not selected', async () => {
    await uploadsHandler.handler({ targets: ['db'], force: false })

    expect(Listr2Mock.skippedTaskTitles).toContain(
      'No fs target selected; skipping.',
    )

    const gitignore = vol.readFileSync(
      path.join(BASE_PATH, '.gitignore'),
      'utf-8',
    )
    expect(gitignore).toBe(`${GITIGNORE}\n`)
  })
})
