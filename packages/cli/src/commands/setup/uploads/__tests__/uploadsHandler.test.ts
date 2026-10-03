vi.mock('node:fs')

import '../../../../lib/mockTelemetry'

import path from 'node:path'

import { vol, fs as memfsFs } from 'memfs'
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

// The handler reads its template files through the mocked `node:fs`, so the real
// template contents are seeded into memfs under their real source-tree paths.
const TEMPLATE_DIR = path.join(import.meta.dirname, '..', 'templates')

beforeEach(() => {
  vol.reset()
  vol.fromJSON(
    {
      [path.join(TEMPLATE_DIR, 'srcLibUploads.ts.template')]:
        SRC_LIB_UPLOADS_TEMPLATE,
      [path.join(TEMPLATE_DIR, 'uploads.sdl.ts.template')]:
        UPLOADS_SDL_TEMPLATE,
      [path.join(TEMPLATE_DIR, 'uploads.ts.template')]:
        UPLOADS_SERVICE_TEMPLATE,
      [path.join(TEMPLATE_DIR, 'requireUploadToken.ts.template')]:
        DIRECTIVE_TEMPLATE,
      [path.join(TEMPLATE_DIR, 'withSignedUrl.ts.template')]:
        DIRECTIVE_TEMPLATE,
      [path.join(TEMPLATE_DIR, 'withDataUri.ts.template')]: DIRECTIVE_TEMPLATE,
      'package.json': JSON.stringify({
        devDependencies: { '@cedarjs/core': '1.0.0' },
      }),
      'api/tsconfig.json': '',
      'api/db/schema.prisma': 'datasource db {\n  provider = "sqlite"\n}\n',
      '.gitignore': '.DS_Store\n.env*\ndev.db*\ndist\nnode_modules\n',
      'api/src/lib': null,
      'api/src/graphql': null,
      'api/src/services/uploads': null,
      'api/src/functions/graphql.ts': '',
      'api/src/server.ts': SERVER,
    },
    BASE_PATH,
  )
})

const SRC_LIB_UPLOADS_TEMPLATE =
  "__PATH_IMPORT____S3_IMPORTS__import {\n  __FS_IMPORT__\n  __DB_IMPORT__\n  __DB_MAX_IMPORT__\n  defineStorageTargets,\n  defineUploadProfiles,\n} from '@cedarjs/uploads'\n__GET_PATHS_IMPORT__\n__S3_CLIENT__\n/**\n * Where files live. Each target is a provider instance; the Upload row\n * records which target holds a file so it can be read, served, and deleted\n * later. Look one up by name with `resolveTarget(targets, upload.target)`.\n */\nexport const targets = defineStorageTargets({\n__TARGETS__})\n\n/**\n * What clients may upload. A profile names a target and the constraints the\n * server signs into every upload token issued for it. The client never\n * supplies constraints; it names a profile.\n */\nexport const profiles = defineUploadProfiles({\n__PROFILES__})\n"

const UPLOADS_SDL_TEMPLATE =
  'export const schema = gql`\n  type Upload {\n    id: String!\n    target: String!\n    status: String!\n    filename: String!\n    mimeType: String!\n    size: BigInt!\n    storageKey: String\n    userId: String\n    organizationId: String\n    createdAt: DateTime!\n    updatedAt: DateTime!\n  }\n\n  type UploadToken {\n    token: String!\n    """\n    The profile\'s constraints, echoed for client-side UX (file-picker\n    filters, pre-upload validation). The authoritative copy is inside the\n    signed token.\n    """\n    allowedMimeTypes: [String!]!\n    maxFileSize: BigInt!\n    maxFiles: Int!\n  }\n\n  type PresignedUploadUrl {\n    uploadId: String!\n    url: String!\n    method: String!\n    headers: JSON!\n  }\n\n  input CreatePresignedUploadUrlInput {\n    filename: String!\n    contentType: String!\n    size: BigInt!\n  }\n\n  input UploadFileInput {\n    filename: String!\n    mimeType: String!\n    """\n    The file\'s bytes, base64-encoded. Only for profiles whose target stores\n    files inline in the database.\n    """\n    data: String!\n  }\n\n  type Query {\n    """\n    Issues an upload token for a server-defined profile. The profile name\n    must match a key of \\`profiles\\` in api/src/lib/uploads.\n    """\n    requestUploadToken(profile: String!): UploadToken! @requireAuth\n  }\n\n  type Mutation {\n    """\n    Direct-to-storage uploads: returns a presigned URL for one file. Send the\n    upload token in the x-upload-token header.\n    """\n    createPresignedUploadUrl(\n      input: CreatePresignedUploadUrlInput!\n    ): PresignedUploadUrl! @requireAuth @requireUploadToken\n\n    """\n    Confirms a direct-to-storage upload once the client has PUT the bytes.\n    """\n    confirmUpload(uploadId: String!): Upload! @requireAuth\n\n    """\n    Stores a small file sent as base64, for profiles whose target keeps files\n    inline in the database.\n    """\n    uploadFile(profile: String!, input: UploadFileInput!): Upload! @requireAuth\n  }\n`\n'

const UPLOADS_SERVICE_TEMPLATE =
  "import {\n  confirmUpload as confirmUploadRecord,\n  createPresignedUpload,\n  getUploadTokenPayload,\n  isMimeTypeAllowed,\n  issueUploadToken,\n  resolveProfile,\n  resolveTarget,\n  storeFile,\n  UploadError,\n} from '@cedarjs/uploads'\n\nimport { db } from 'src/lib/db'\nimport { profiles, targets } from 'src/lib/uploads'\n\nconst secret = () => {\n  if (!process.env.UPLOAD_TOKEN_SECRET) {\n    throw new Error(\n      'UPLOAD_TOKEN_SECRET is not set. Generate one with `yarn cedar generate secret` and add it to .env.',\n    )\n  }\n\n  return process.env.UPLOAD_TOKEN_SECRET\n}\n\nexport const requestUploadToken = ({ profile }: { profile: string }) => {\n  return issueUploadToken({\n    profiles,\n    profile,\n    secret: secret(),\n    currentUser: context.currentUser,\n  })\n}\n\nexport const createPresignedUploadUrl = ({\n  input,\n}: {\n  input: { filename: string; contentType: string; size: bigint | number }\n}) => {\n  return createPresignedUpload({\n    db,\n    targets,\n    tokenPayload: getUploadTokenPayload(context),\n    input,\n  })\n}\n\nexport const confirmUpload = ({ uploadId }: { uploadId: string }) => {\n  return confirmUploadRecord({\n    db,\n    targets,\n    uploadId,\n    currentUser: context.currentUser,\n  })\n}\n\nexport const uploadFile = async ({\n  profile: profileName,\n  input,\n}: {\n  profile: string\n  input: { filename: string; mimeType: string; data: string }\n}) => {\n  const profile = resolveProfile(profiles, profileName)\n  const target = resolveTarget(targets, profile.target)\n\n  if (target.providerType !== 'db') {\n    throw new UploadError(\n      'NOT_SUPPORTED',\n      `Upload profile '${profile.name}' does not store files in the database. Use an upload token instead.`,\n    )\n  }\n\n  if (!isMimeTypeAllowed(profile.allowedMimeTypes, input.mimeType)) {\n    throw new UploadError(\n      'MIME_TYPE_NOT_ALLOWED',\n      `File type '${input.mimeType}' is not allowed for upload profile '${profile.name}'.`,\n    )\n  }\n\n  return storeFile(target, {\n    db,\n    filename: input.filename,\n    mimeType: input.mimeType,\n    data: Buffer.from(input.data, 'base64'),\n    maxSize: profile.maxFileSize,\n    userId: context.currentUser ? String(context.currentUser.id) : undefined,\n  })\n}\n"

const SERVER = `import { createServer } from '@cedarjs/api-server'

async function main() {
  const server = await createServer({})

  await server.start()
}

main()
`

const DIRECTIVE_TEMPLATE = `export const requireUploadToken = () => {}
`

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
    expect(gitignore).toBe(
      '.DS_Store\n.env*\ndev.db*\napi/.uploads\ndist\nnode_modules\n',
    )
  })

  it('creates .gitignore when it does not exist', async () => {
    vol.rmSync(path.join(BASE_PATH, '.gitignore'), { force: true })

    await uploadsHandler.handler({ targets: ['fs'], force: false })

    const gitignore = vol.readFileSync(
      path.join(BASE_PATH, '.gitignore'),
      'utf-8',
    )
    expect(gitignore).toBe(`\n${UPLOADS_GITIGNORE_ENTRY}\n`)
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
    expect(gitignore).toBe('.DS_Store\n.env*\ndev.db*\ndist\nnode_modules\n')
  })
})
