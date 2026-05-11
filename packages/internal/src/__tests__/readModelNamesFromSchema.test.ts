import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, test, vi } from 'vitest'

import type * as ProjectConfig from '@cedarjs/project-config'

// `getPaths` / `getSchemaPath` are the only project-config helpers exercised by
// `readModelNamesFromSchema`. Stub them to point at a per-test temp directory
// so the function under test does real filesystem work against fixtures we
// control, without dragging in the rest of a Cedar project.
const mockGetPaths = vi.hoisted(() =>
  vi.fn<() => { api: { prismaConfig: string | null } }>(),
)
const mockGetSchemaPath = vi.hoisted(() =>
  vi.fn<(prismaConfig: string | null) => Promise<string | null>>(),
)

vi.mock('@cedarjs/project-config', async (importOriginal) => {
  const original = await importOriginal<typeof ProjectConfig>()
  return {
    ...original,
    getPaths: mockGetPaths,
    getSchemaPath: mockGetSchemaPath,
  }
})

// Import after the mocks are registered so `readModelNamesFromSchema` picks
// them up.
const { readModelNamesFromSchema } =
  await import('../generate/graphqlCodeGen.js')

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'cedar-read-model-names-from-schema-'),
  )
  mockGetPaths.mockReturnValue({ api: { prismaConfig: null } })
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
  vi.clearAllMocks()
})

describe('readModelNamesFromSchema', () => {
  it('parses model declarations from a single-file schema', async () => {
    const schemaPath = path.join(tmpDir, 'schema.prisma')
    fs.writeFileSync(
      schemaPath,
      [
        'generator client { provider = "prisma-client" }',
        '',
        'model User {',
        '  id Int @id',
        '}',
        '',
        'model Post {',
        '  id Int @id',
        '  authorId Int',
        '}',
        '',
      ].join('\n'),
    )
    mockGetSchemaPath.mockResolvedValue(schemaPath)

    const result = await readModelNamesFromSchema()

    expect(result).toEqual({ User: 'User', Post: 'Post' })
  })

  it('merges model declarations across multi-file directory schemas', async () => {
    const schemaDir = path.join(tmpDir, 'schema')
    fs.mkdirSync(schemaDir)
    fs.writeFileSync(
      path.join(schemaDir, 'user.prisma'),
      ['model User {', '  id Int @id', '}'].join('\n'),
    )
    fs.writeFileSync(
      path.join(schemaDir, 'post.prisma'),
      ['model Post {', '  id Int @id', '}'].join('\n'),
    )
    // Non-prisma file in the same dir should be ignored.
    fs.writeFileSync(
      path.join(schemaDir, 'notes.txt'),
      'model Decoy { id Int @id }',
    )
    mockGetSchemaPath.mockResolvedValue(schemaDir)

    const result = await readModelNamesFromSchema()

    expect(result).toEqual({ User: 'User', Post: 'Post' })
  })

  it('ignores subdirectories whose names end with .prisma', async () => {
    // Regression: a previous version filtered by name only and crashed with
    // EISDIR when a subdirectory happened to be named e.g. `views.prisma/`.
    const schemaDir = path.join(tmpDir, 'schema')
    fs.mkdirSync(schemaDir)
    fs.mkdirSync(path.join(schemaDir, 'views.prisma'))
    fs.writeFileSync(
      path.join(schemaDir, 'main.prisma'),
      ['model User {', '  id Int @id', '}'].join('\n'),
    )
    mockGetSchemaPath.mockResolvedValue(schemaDir)

    const result = await readModelNamesFromSchema()

    expect(result).toEqual({ User: 'User' })
  })

  it('returns null when the schema has no model declarations', async () => {
    const schemaPath = path.join(tmpDir, 'schema.prisma')
    fs.writeFileSync(
      schemaPath,
      [
        'generator client { provider = "prisma-client" }',
        'datasource db { provider = "postgresql" url = env("DATABASE_URL") }',
      ].join('\n'),
    )
    mockGetSchemaPath.mockResolvedValue(schemaPath)

    const result = await readModelNamesFromSchema()

    expect(result).toBeNull()
  })

  it('returns null when getSchemaPath resolves to null', async () => {
    mockGetSchemaPath.mockResolvedValue(null)

    const result = await readModelNamesFromSchema()

    expect(result).toBeNull()
  })

  it('returns null when the schema path does not exist', async () => {
    mockGetSchemaPath.mockResolvedValue(path.join(tmpDir, 'missing.prisma'))

    const result = await readModelNamesFromSchema()

    expect(result).toBeNull()
  })

  it('returns null when getSchemaPath throws', async () => {
    mockGetSchemaPath.mockRejectedValue(new Error('boom'))

    const result = await readModelNamesFromSchema()

    expect(result).toBeNull()
  })

  test('regex matches `model` lines with surrounding whitespace and ignores comments', async () => {
    const schemaPath = path.join(tmpDir, 'schema.prisma')
    fs.writeFileSync(
      schemaPath,
      [
        '// model CommentedOut { id Int @id }',
        '   model Indented {',
        '  id Int @id',
        '}',
        '',
        'model Tight{',
        '  id Int @id',
        '}',
        '',
        'model PaddedName    {',
        '  id Int @id',
        '}',
      ].join('\n'),
    )
    mockGetSchemaPath.mockResolvedValue(schemaPath)

    const result = await readModelNamesFromSchema()

    expect(result).toEqual({
      Indented: 'Indented',
      Tight: 'Tight',
      PaddedName: 'PaddedName',
    })
    expect(result).not.toHaveProperty('CommentedOut')
  })
})
