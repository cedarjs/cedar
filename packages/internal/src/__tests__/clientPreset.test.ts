import fs from 'node:fs'
import path from 'path'

import { vi, beforeEach, afterEach, describe, test, expect } from 'vitest'

import type ProjectConfig from '@cedarjs/project-config'

import { generateClientPreset } from '../generate/clientPreset.js'
import { generateGraphQLSchema } from '../generate/graphqlSchema.js'

const { mockedGetConfig } = vi.hoisted(() => {
  return {
    mockedGetConfig: vi.fn().mockReturnValue({
      graphql: { trustedDocuments: false, includeScalars: { File: true } },
    }),
  }
})

vi.mock('@cedarjs/project-config', async (importOriginal) => {
  const projectConfig = await importOriginal<typeof ProjectConfig>()
  return {
    ...projectConfig,
    getConfig: mockedGetConfig,
  }
})

const FIXTURE_PATH = path.resolve(
  __dirname,
  '../../../../__fixtures__/example-todo-main',
)

beforeEach(() => {
  process.env.CEDAR_CWD = FIXTURE_PATH
})

afterEach(() => {
  delete process.env.CEDAR_CWD
  mockedGetConfig.mockReturnValue({
    graphql: { trustedDocuments: false, includeScalars: { File: true } },
  })
})

describe('Generate client preset', () => {
  test('for web side', async () => {
    mockedGetConfig.mockReturnValue({
      graphql: { trustedDocuments: true, includeScalars: { File: true } },
    })
    await generateGraphQLSchema()

    const { clientPresetFiles, errors } = await generateClientPreset()
    expect(errors).toHaveLength(0)

    expect(clientPresetFiles).toHaveLength(5)
    const expectedBasenames = [
      'fragment-masking.ts',
      'index.ts',
      'gql.ts',
      'graphql.ts',
      'persisted-documents.json',
    ]

    // The filenames are absolute paths with platform-native separators, so
    // only compare the basenames
    const foundBasenames = clientPresetFiles.map((filename) =>
      path.basename(filename),
    )

    expect(foundBasenames.toSorted()).toEqual(expectedBasenames.toSorted())
  })

  test('for api side', async () => {
    mockedGetConfig.mockReturnValue({
      graphql: { trustedDocuments: true, includeScalars: { File: true } },
    })
    await generateGraphQLSchema()

    const { trustedDocumentsStoreFile, errors } = await generateClientPreset()
    expect(errors).toHaveLength(0)

    expect(trustedDocumentsStoreFile).toContain('trustedDocumentsStore.ts')
  })

  test('types custom scalar fields as `any`', async () => {
    mockedGetConfig.mockReturnValue({
      graphql: { trustedDocuments: true, includeScalars: { File: true } },
    })

    // The probe document is added to a copy of the fixture, so other tests
    // reading the fixture don't pick it up. The copy lives inside this
    // package so that codegen can resolve its presets and plugins from the
    // workspace's node_modules
    const cacheDir = path.resolve(__dirname, '../../node_modules/.cache')
    fs.mkdirSync(cacheDir, { recursive: true })
    const projectCopy = fs.mkdtempSync(
      path.join(cacheDir, 'cedar-client-preset-'),
    )
    fs.cpSync(FIXTURE_PATH, projectCopy, { recursive: true })
    process.env.CEDAR_CWD = projectCopy

    // `currentUser` is a `JSON` field. The fixture's own documents don't
    // select any custom scalar fields
    const probeFile = path.join(
      projectCopy,
      'web/src/components/ScalarProbe/ScalarProbe.js',
    )
    fs.mkdirSync(path.dirname(probeFile), { recursive: true })
    fs.writeFileSync(
      probeFile,
      'export const QUERY = gql`\n  query ScalarProbe_CurrentUser {\n    currentUser\n  }\n`\n',
    )

    try {
      await generateGraphQLSchema()
      const { clientPresetFiles, errors } = await generateClientPreset()
      expect(errors).toHaveLength(0)

      const graphqlFile = clientPresetFiles.find(
        (filename) => path.basename(filename) === 'graphql.ts',
      )
      expect(graphqlFile).toBeDefined()

      const output = fs.readFileSync(graphqlFile ?? '', 'utf-8')
      expect(output).toMatch(
        /export type ScalarProbe_CurrentUserQuery = \{[^}]*\bcurrentUser: any\b/,
      )
    } finally {
      fs.rmSync(projectCopy, { recursive: true, force: true })
    }
  })
})
