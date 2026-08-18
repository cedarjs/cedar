import { vi, afterEach, describe, expect, test } from 'vitest'

import type ProjectConfig from '@cedarjs/project-config'

import { generate, run } from '../generate/generate.js'

const { mockedGetConfig, mockedGetPaths, mockedGenerateClientPreset } =
  vi.hoisted(() => {
    return {
      mockedGetConfig: vi.fn().mockReturnValue({
        graphql: { trustedDocuments: true },
      }),
      mockedGetPaths: vi.fn().mockReturnValue({ base: '/app' }),
      mockedGenerateClientPreset: vi.fn(),
    }
  })

vi.mock('@cedarjs/project-config', async (importOriginal) => {
  const projectConfig = await importOriginal<typeof ProjectConfig>()
  return {
    ...projectConfig,
    getConfig: mockedGetConfig,
    getPaths: mockedGetPaths,
  }
})

vi.mock('@cedarjs/cli-helpers/loadEnvFiles', () => ({
  loadEnvFiles: vi.fn(),
}))

vi.mock('../generate/graphqlSchema.js', () => ({
  generateGraphQLSchema: async () => ({ schemaPath: '', errors: [] }),
}))
vi.mock('../generate/typeDefinitions.js', () => ({
  generateTypeDefs: async () => ({ typeDefFiles: [], errors: [] }),
}))
vi.mock('../generate/possibleTypes.js', () => ({
  generatePossibleTypes: async () => ({ possibleTypesFiles: [], errors: [] }),
}))
vi.mock('../generate/gqlormSchema.js', () => ({
  generateGqlormArtifacts: async () => ({ files: [], errors: [] }),
}))
vi.mock('../generate/clientPreset.js', () => ({
  generateClientPreset: mockedGenerateClientPreset,
}))

afterEach(() => {
  vi.clearAllMocks()
})

describe('generate', () => {
  test('surfaces client preset errors instead of swallowing them', async () => {
    mockedGenerateClientPreset.mockResolvedValue({
      clientPresetFiles: [],
      trustedDocumentsStoreFile: '',
      errors: [
        {
          message: 'Error: Could not generate GraphQL client preset',
          error: new Error('Unable to find any GraphQL type definitions'),
        },
      ],
    })

    const { files, errors } = await generate()

    expect(files).toEqual([])
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toBe(
      'Error: Could not generate GraphQL client preset',
    )
  })

  test('sets a non-zero exit code when run() surfaces client preset errors', async () => {
    mockedGenerateClientPreset.mockResolvedValue({
      clientPresetFiles: [],
      trustedDocumentsStoreFile: '',
      errors: [
        {
          message: 'Error: Could not generate GraphQL client preset',
          error: new Error('Unable to find any GraphQL type definitions'),
        },
      ],
    })

    const originalExitCode = process.exitCode

    try {
      await run()
      expect(process.exitCode).toBe(1)
    } finally {
      process.exitCode = originalExitCode
    }
  })

  test('lists the generated trusted documents store', async () => {
    mockedGenerateClientPreset.mockResolvedValue({
      clientPresetFiles: ['/app/web/src/graphql/gql.ts'],
      trustedDocumentsStoreFile: '/app/api/src/lib/trustedDocumentsStore.ts',
      errors: [],
    })

    const { files, errors } = await generate()

    expect(errors).toHaveLength(0)
    expect(files).toEqual([
      '/app/web/src/graphql/gql.ts',
      '/app/api/src/lib/trustedDocumentsStore.ts',
    ])
  })

  test('does not run the client preset when trusted documents are off', async () => {
    mockedGetConfig.mockReturnValue({ graphql: { trustedDocuments: false } })

    const { files, errors } = await generate()

    expect(mockedGenerateClientPreset).not.toHaveBeenCalled()
    expect(files).toEqual([])
    expect(errors).toHaveLength(0)
  })
})
