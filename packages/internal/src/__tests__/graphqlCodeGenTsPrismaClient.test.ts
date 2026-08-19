import fs from 'node:fs'
import path from 'node:path'

const { tsPrismaClientPath, driftedPrismaClientPath } = await vi.hoisted(
  async () => {
    const path = await import('node:path')

    // A TypeScript Prisma client, as emitted by the `prisma-client` generator
    // when the schema sets `generatedFileExtension = "ts"`. Codegen reads the
    // model names out of the `models.ts` barrel next to it rather than
    // importing the client.
    const tsPrismaClientPath = path.resolve(
      import.meta.dirname,
      '__fixtures__/graphqlCodeGen/tsPrismaClient/client.ts',
    )
    // The same, but with a `models.ts` in a shape we don't know how to read.
    const driftedPrismaClientPath = path.resolve(
      import.meta.dirname,
      '__fixtures__/graphqlCodeGen/tsPrismaClientDrift/client.ts',
    )
    return { tsPrismaClientPath, driftedPrismaClientPath }
  },
)

import { beforeAll, afterAll, afterEach, vi, test, expect } from 'vitest'

import type * as ProjectConfig from '@cedarjs/project-config'

import { generateTypeDefGraphQLApi } from '../generate/graphqlCodeGen.js'
import { generateGraphQLSchema } from '../generate/graphqlSchema.js'

const FIXTURE_PATH = path.resolve(
  __dirname,
  '../../../../__fixtures__/example-todo-main',
)

const originalCedarCwd = process.env.CEDAR_CWD

let clientPath = tsPrismaClientPath

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
  clientPath = tsPrismaClientPath
  vi.restoreAllMocks()
})

vi.mock('@cedarjs/project-config', async (importOriginal) => {
  const originalProjectConfig = await importOriginal<typeof ProjectConfig>()

  return {
    ...originalProjectConfig,
    resolveGeneratedPrismaClient: () =>
      Promise.resolve({ clientPath, error: undefined }),
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

test('Fails loudly when no models can be read', async () => {
  clientPath = driftedPrismaClientPath

  await expect(generateTypeDefGraphQLApi()).rejects.toThrow(
    /Could not read any Prisma model names/,
  )
})
