import fs from 'node:fs'
import path from 'node:path'

const { tsPrismaClientPath } = await vi.hoisted(async () => {
  const path = await import('node:path')

  // A TypeScript Prisma client, as emitted by the `prisma-client` generator
  // when the schema sets `generatedFileExtension = "ts"` (the default in
  // Prisma 7). Node can't `import()` it, so codegen has to read `ModelName`
  // from `internal/prismaNamespace.ts` instead.
  const tsPrismaClientPath = path.resolve(
    import.meta.dirname,
    '__fixtures__/graphqlCodeGen/tsPrismaClient/client.ts',
  )
  return { tsPrismaClientPath }
})

import { beforeAll, afterAll, afterEach, vi, test, expect } from 'vitest'

import type * as ProjectConfig from '@cedarjs/project-config'

import { generateTypeDefGraphQLApi } from '../generate/graphqlCodeGen.js'
import { generateGraphQLSchema } from '../generate/graphqlSchema.js'

const FIXTURE_PATH = path.resolve(
  __dirname,
  '../../../../__fixtures__/example-todo-main',
)

const originalCedarCwd = process.env.CEDAR_CWD

beforeAll(() => {
  process.env.CEDAR_CWD = FIXTURE_PATH
})

afterAll(() => {
  if (originalCedarCwd === undefined) {
    delete process.env.CEDAR_CWD
  } else {
    process.env.CEDAR_CWD = originalCedarCwd
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

vi.mock('@cedarjs/project-config', async (importOriginal) => {
  const originalProjectConfig = await importOriginal<typeof ProjectConfig>()

  return {
    ...originalProjectConfig,
    resolveGeneratedPrismaClient: () =>
      Promise.resolve({ clientPath: tsPrismaClientPath, error: undefined }),
  }
})

test('Reads Prisma models from a TypeScript prisma-client', async () => {
  await generateGraphQLSchema()

  let codegenOutput: {
    file: fs.PathOrFileDescriptor
    data: string | ArrayBufferView
  } = { file: '', data: '' }

  vi.spyOn(fs, 'writeFileSync').mockImplementation(
    (file: fs.PathOrFileDescriptor, data: string | ArrayBufferView) => {
      codegenOutput = { file, data }
    },
  )

  const { typeDefFiles, errors } = await generateTypeDefGraphQLApi()

  expect(errors).toEqual([])
  expect(typeDefFiles).toHaveLength(1)

  const { data } = codegenOutput

  // Without the static read, `import()` of a `.ts` client throws, the model
  // list comes back empty and no Prisma models are imported at all
  expect(data).toContain(
    "import { PrismaModelOne as PrismaPrismaModelOne, PrismaModelTwo as PrismaPrismaModelTwo, Post as PrismaPost, Todo as PrismaTodo } from 'src/lib/db'",
  )
  expect(data).toContain(`type AllMappedModels = MaybeOrArrayOfMaybe<Todo>`)
})
