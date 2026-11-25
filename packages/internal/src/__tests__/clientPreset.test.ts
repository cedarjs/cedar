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

  describe('scalar types', () => {
    /**
     * Generates the client preset for a copy of the fixture with a document
     * that selects `currentUser`, a `JSON` field, and returns the generated
     * `graphql.ts`. The fixture's own documents don't select any custom
     * scalar fields
     */
    async function generateProbeTypes(codegenConfig?: string) {
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
      // Other test files write to the fixture while it's copied: temporary
      // directories in `.cedar`, which holds generated files, and a
      // temporary `codegen.yml`. Neither is part of the fixture, and a
      // directory removed while it's being copied crashes the test worker
      const leftOut = new Set(
        ['.cedar', 'codegen.yml'].map((name) => path.join(FIXTURE_PATH, name)),
      )
      fs.cpSync(FIXTURE_PATH, projectCopy, {
        recursive: true,
        filter: (source) => !leftOut.has(source),
      })
      process.env.CEDAR_CWD = projectCopy

      const probeFile = path.join(
        projectCopy,
        'web/src/components/ScalarProbe/ScalarProbe.js',
      )
      fs.mkdirSync(path.dirname(probeFile), { recursive: true })
      fs.writeFileSync(
        probeFile,
        'export const QUERY = gql`\n  query ScalarProbe_CurrentUser {\n    currentUser\n  }\n`\n',
      )

      if (codegenConfig) {
        fs.writeFileSync(path.join(projectCopy, 'codegen.yml'), codegenConfig)
      }

      try {
        await generateGraphQLSchema()
        const { clientPresetFiles, errors } = await generateClientPreset()
        expect(errors).toHaveLength(0)

        const graphqlFile = clientPresetFiles.find(
          (filename) => path.basename(filename) === 'graphql.ts',
        )
        expect(graphqlFile).toBeDefined()

        return fs.readFileSync(graphqlFile ?? '', 'utf-8')
      } finally {
        fs.rmSync(projectCopy, { recursive: true, force: true })
      }
    }

    test("uses Cedar's built-in scalar mappings", async () => {
      const output = await generateProbeTypes()

      expect(output).toMatch(
        /export type ScalarProbe_CurrentUserQuery = \{[^}]*\bcurrentUser: Prisma\.JsonValue\b/,
      )
      expect(output).toContain("import type { Prisma } from '$api/src/lib/db'")
    })

    test('merges in the scalars from the codegen config', async () => {
      const output = await generateProbeTypes(
        'config:\n  scalars:\n    JSON: Record<string, string>\n',
      )

      expect(output).toMatch(
        /export type ScalarProbe_CurrentUserQuery = \{[^}]*\bcurrentUser: Record<string, string>/,
      )
    })

    test('imports a relative scalar mapping from the same file as web/types/graphql.d.ts does', async () => {
      const output = await generateProbeTypes(
        'config:\n  scalars:\n    JSON: ../../types/scalars#JsonValue\n',
      )

      // web/types/graphql.d.ts imports `../../types/scalars`, the project's
      // types/scalars. From web/src/graphql/ the same file is three levels up
      expect(output).toMatch(
        /import (type )?\{ JsonValue \} from '\.\.\/\.\.\/\.\.\/types\/scalars'/,
      )
    })

    test('keeps a rebased mapping into a dot-directory relative', async () => {
      const output = await generateProbeTypes(
        'config:\n  scalars:\n    JSON: ../src/graphql/.generated/scalars#JsonValue\n',
      )

      expect(output).toMatch(
        /import (type )?\{ JsonValue \} from '\.\/\.generated\/scalars'/,
      )
    })

    test('imports every scalar from a relative scalars module', async () => {
      const output = await generateProbeTypes(
        'config:\n  scalars: ../../types/scalars\n',
      )

      expect(output).toMatch(
        /import (type )?\{[^}]*\bJSON\b[^}]*\} from '\.\.\/\.\.\/\.\.\/types\/scalars'/,
      )
    })

    test("keeps Cedar's mappings for scalars the codegen config doesn't list", async () => {
      const output = await generateProbeTypes(
        'config:\n  scalars:\n    DateTime: Date\n',
      )

      expect(output).toMatch(
        /export type ScalarProbe_CurrentUserQuery = \{[^}]*\bcurrentUser: Prisma\.JsonValue\b/,
      )
    })
  })
})
