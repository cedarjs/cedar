import fs from 'fs'
import path from 'path'

import ansis from 'ansis'
import { terminalLink } from 'termi-link'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'

import { generateGraphQLSchema } from '../generate/graphqlSchema.js'

const FIXTURE_PATH = path.resolve(
  __dirname,
  '../../../../__fixtures__/example-todo-main',
)

beforeEach(() => {
  process.env.RWJS_CWD = FIXTURE_PATH
})

afterEach(() => {
  delete process.env.RWJS_CWD
  vi.restoreAllMocks()
})

test('Generates GraphQL schema', async () => {
  const expectedPath = path.join(FIXTURE_PATH, '.redwood', 'schema.graphql')

  vi.spyOn(fs, 'writeFileSync').mockImplementation(
    (file: fs.PathOrFileDescriptor, data: string | ArrayBufferView) => {
      expect(file).toMatch(expectedPath)
      expect(data).toMatchSnapshot()
    },
  )

  const { schemaPath, errors } = await generateGraphQLSchema()

  expect(errors).toEqual([])
  expect(schemaPath).toMatch(expectedPath)
})

test('Includes live query directive if serverful and realtime ', async () => {
  const fixturePath = path.resolve(
    __dirname,
    './__fixtures__/graphqlCodeGen/realtime',
  )
  process.env.RWJS_CWD = fixturePath

  const expectedPath = path.join(fixturePath, '.redwood', 'schema.graphql')

  vi.spyOn(fs, 'writeFileSync').mockImplementation(
    (file: fs.PathOrFileDescriptor, data: string | ArrayBufferView) => {
      expect(file).toMatch(expectedPath)
      expect(data).toMatchSnapshot()
    },
  )

  await generateGraphQLSchema()
})

test('Returns error message when schema loading fails', async () => {
  const fixturePath = path.resolve(
    __dirname,
    './__fixtures__/graphqlCodeGen/bookshelf',
  )
  process.env.RWJS_CWD = fixturePath

  try {
    const { errors } = await generateGraphQLSchema()

    const [schemaLoadingError] = errors

    expect(schemaLoadingError.message).toEqual(
      [
        'Schema loading failed. Unknown type: "Shelf".',
        '',
        `  ${ansis.bgYellow(` ${ansis.black.bold('Heads up')} `)}`,
        '',
        ansis.yellow(
          `  It looks like you have a Shelf model in your Prisma schema.`,
        ),
        ansis.yellow(
          `  If it's part of a relation, you may have to generate SDL or scaffolding for Shelf too.`,
        ),
        ansis.yellow(
          `  So, if you haven't done that yet, ignore this error message and run the SDL or scaffold generator for Shelf now.`,
        ),
        '',
        ansis.yellow(
          `  See the ${terminalLink(
            'Troubleshooting Generators',
            'https://redwoodjs.com/docs/schema-relations#troubleshooting-generators',
          )} section in our docs for more help.`,
        ),
      ].join('\n'),
    )
  } finally {
    delete process.env.RWJS_CWD
  }
})

test('Generates complete schema with directives and subscriptions while excluding test files', async () => {
  const fixturePath = path.resolve(
    __dirname,
    './__fixtures__/graphqlCodeGen/testFilesExclusion',
  )
  process.env.RWJS_CWD = fixturePath

  const expectedPath = path.join(fixturePath, '.redwood', 'schema.graphql')

  let generatedSchema = ''
  let writeFileSyncSchemaPath = ''

  vi.spyOn(fs, 'writeFileSync').mockImplementation(
    (file: fs.PathOrFileDescriptor, data: string | ArrayBufferView) => {
      writeFileSyncSchemaPath = file.toString()
      generatedSchema = data.toString()
    },
  )

  const { schemaPath, errors } = await generateGraphQLSchema()

  expect(errors).toEqual([])
  expect(schemaPath).toMatch(expectedPath)
  expect(writeFileSyncSchemaPath).toMatch(expectedPath)
  expect(generatedSchema).toMatchSnapshot()
})
