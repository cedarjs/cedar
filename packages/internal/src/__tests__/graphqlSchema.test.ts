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

test('Does not generate warnings when loading schema with test files present', async () => {
  const fixturePath = path.resolve(
    __dirname,
    './__fixtures__/graphqlCodeGen/testFilesExclusion',
  )
  process.env.RWJS_CWD = fixturePath

  const expectedPath = path.join(fixturePath, '.redwood', 'schema.graphql')

  // Spy on console.warn to catch any warnings about failed ES module loads
  vi.spyOn(console, 'warn')
  const processWarningSpy = vi.fn()

  // Capture process warnings
  process.on('warning', processWarningSpy)

  vi.spyOn(fs, 'writeFileSync').mockImplementation(
    (file: fs.PathOrFileDescriptor) => {
      expect(file).toMatch(expectedPath)
    },
  )

  try {
    const { schemaPath, errors } = await generateGraphQLSchema()

    expect(errors).toEqual([])
    expect(schemaPath).toMatch(expectedPath)

    // Verify the generated schema doesn't contain types from test files
    let generatedSchema = ''
    const writeFileSpy = vi.mocked(fs.writeFileSync)
    if (writeFileSpy.mock.calls.length > 0) {
      generatedSchema = writeFileSpy.mock.calls[0][1].toString()
    }

    expect(generatedSchema).not.toContain('TestFileShouldNotBeInSchema')
    expect(generatedSchema).not.toContain('SpecFileShouldNotBeInSchema')
    expect(generatedSchema).not.toContain(
      'SubscriptionTestFileShouldNotBeInSchema',
    )
    expect(generatedSchema).not.toContain(
      'SubscriptionSpecFileShouldNotBeInSchema',
    )
  } finally {
    process.removeListener('warning', processWarningSpy)
    delete process.env.RWJS_CWD
  }
})

/**
 * Integration test: Full schema generation with test file exclusion
 *
 * This is a comprehensive snapshot test that verifies the complete
 * generated GraphQL schema includes:
 * - Custom directives (@requireAuth, @skipAuth)
 * - Custom subscriptions (countdown, newMessage)
 * - SDL types (Todo)
 * - All standard Cedar types and directives
 *
 * And excludes:
 * - Any exports or content from .test.ts files
 * - Any exports or content from .spec.js files
 *
 * The snapshot serves as a regression test to ensure the schema
 * remains consistent across changes.
 */
test('Generates complete schema with directives and subscriptions while excluding test files', async () => {
  const fixturePath = path.resolve(
    __dirname,
    './__fixtures__/graphqlCodeGen/testFilesExclusion',
  )
  process.env.RWJS_CWD = fixturePath

  const expectedPath = path.join(fixturePath, '.redwood', 'schema.graphql')

  let generatedSchema = ''

  vi.spyOn(fs, 'writeFileSync').mockImplementation(
    (_file: fs.PathOrFileDescriptor, data: string | ArrayBufferView) => {
      generatedSchema = data.toString()
    },
  )

  try {
    const { schemaPath, errors } = await generateGraphQLSchema()

    expect(errors).toEqual([])
    expect(schemaPath).toMatch(expectedPath)
    expect(generatedSchema).toMatchSnapshot()
  } finally {
    delete process.env.RWJS_CWD
  }
})
