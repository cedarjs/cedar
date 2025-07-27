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

beforeEach(() => {
  const FIXTURE_PATH = path.resolve(
    __dirname,
    '../../../../__fixtures__/example-todo-main',
  )

  process.env.RWJS_CWD = FIXTURE_PATH
})

afterEach(() => {
  delete process.env.RWJS_CWD
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
    const expectedEndings = [
      '/fragment-masking.ts',
      '/index.ts',
      '/gql.ts',
      '/graphql.ts',
      '/persisted-documents.json',
    ]

    const foundEndings = expectedEndings.filter((expectedEnding) =>
      clientPresetFiles.some((filename) => filename.endsWith(expectedEnding)),
    )

    expect(foundEndings).toHaveLength(expectedEndings.length)
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
})
