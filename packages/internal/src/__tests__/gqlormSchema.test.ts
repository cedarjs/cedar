import fs from 'node:fs'
import path from 'node:path'

import type { Document, Field, FieldKind, Model } from '@prisma/dmmf'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type * as ProjectConfig from '@cedarjs/project-config'
import { getPaths } from '@cedarjs/project-config'

import {
  buildModelSchema,
  generateGqlormArtifacts,
} from '../generate/gqlormSchema.js'

// ---------------------------------------------------------------------------
// DMMF mock helpers
// ---------------------------------------------------------------------------

function makeField(
  name: string,
  kind: FieldKind = 'scalar',
  documentation?: string,
): Field {
  return {
    name,
    kind,
    type: 'String',
    isRequired: true,
    isList: false,
    isUnique: false,
    isId: false,
    isReadOnly: false,
    hasDefaultValue: false,
    documentation,
  } as Field
}

function makeModel(
  name: string,
  fields: Field[],
  documentation?: string,
): Model {
  return {
    name,
    dbName: null,
    schema: null,
    fields,
    uniqueFields: [],
    uniqueIndexes: [],
    primaryKey: null,
    documentation,
  } as unknown as Model
}

function makeDmmf(models: Model[]): Document {
  return {
    datamodel: {
      models,
      enums: [],
      types: [],
      indexes: [],
    },
  } as unknown as Document
}

// ---------------------------------------------------------------------------
// Unit tests — buildModelSchema (pure function, no fixtures required)
// ---------------------------------------------------------------------------

describe('buildModelSchema', () => {
  it('collects basic scalar fields and excludes object/relation fields', () => {
    const model = makeModel('Post', [
      makeField('id', 'scalar'),
      makeField('title', 'scalar'),
      makeField('author', 'object'),
    ])

    const result = buildModelSchema(makeDmmf([model]))

    expect(result).toEqual({ post: ['id', 'title'] })
  })

  it('includes enum kind fields alongside scalar fields', () => {
    const model = makeModel('Post', [
      makeField('id', 'scalar'),
      makeField('status', 'enum'),
    ])

    const result = buildModelSchema(makeDmmf([model]))

    expect(result).toEqual({ post: ['id', 'status'] })
  })

  it('excludes a field annotated with @gqlorm hide in its documentation', () => {
    const model = makeModel('Post', [
      makeField('id', 'scalar'),
      makeField('body', 'scalar', '@gqlorm hide'),
    ])

    const result = buildModelSchema(makeDmmf([model]))

    expect(result.post).toEqual(['id'])
    expect(result.post).not.toContain('body')
  })

  it('includes a sensitive-named field when its documentation contains @gqlorm show', () => {
    const model = makeModel('Post', [
      makeField('id', 'scalar'),
      makeField('resetToken', 'scalar', '@gqlorm show'),
    ])

    const result = buildModelSchema(makeDmmf([model]))

    expect(result.post).toContain('resetToken')
  })

  it('hides sensitive-named fields via heuristic and emits one console.warn per field', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const model = makeModel('Post', [
      makeField('hashedPassword', 'scalar'),
      makeField('salt', 'scalar'),
      makeField('resetToken', 'scalar'),
      makeField('secretKey', 'scalar'),
      makeField('authToken', 'scalar'),
    ])

    const result = buildModelSchema(makeDmmf([model]))

    // All five fields are sensitive — model has no visible fields so it is
    // omitted from the schema entirely.
    expect(result).not.toHaveProperty('post')
    expect(warnSpy).toHaveBeenCalledTimes(5)

    warnSpy.mockRestore()
  })

  it('suppresses console.warn when @gqlorm hide is set on a sensitive field', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const model = makeModel('Post', [
      makeField('hashedPassword', 'scalar', '@gqlorm hide'),
    ])

    const result = buildModelSchema(makeDmmf([model]))

    // The model has no visible fields so it is omitted from the schema.
    expect(result).not.toHaveProperty('post')
    expect(warnSpy).not.toHaveBeenCalled()

    warnSpy.mockRestore()
  })

  it('excludes an entire model whose documentation contains @gqlorm hide', () => {
    const model = makeModel('Post', [makeField('id', 'scalar')], '@gqlorm hide')

    const result = buildModelSchema(makeDmmf([model]))

    expect(result).not.toHaveProperty('post')
  })

  it('skips RW_DataMigration and Cedar_DataMigration but keeps other models', () => {
    const rwMigration = makeModel('RW_DataMigration', [
      makeField('id', 'scalar'),
    ])
    const cedarMigration = makeModel('Cedar_DataMigration', [
      makeField('id', 'scalar'),
    ])
    const contact = makeModel('Contact', [
      makeField('id', 'scalar'),
      makeField('name', 'scalar'),
    ])

    const result = buildModelSchema(
      makeDmmf([rwMigration, cedarMigration, contact]),
    )

    expect(result).not.toHaveProperty('rw_datamigration')
    expect(result).not.toHaveProperty('cedar_datamigration')
    expect(result).toHaveProperty('contact')
  })

  it('uses lowercased model names as keys in the returned record', () => {
    const model = makeModel('BlogPost', [makeField('id', 'scalar')])

    const result = buildModelSchema(makeDmmf([model]))

    expect(result).toHaveProperty('blogpost')
    expect(result).not.toHaveProperty('BlogPost')
  })

  it('excludes a model when @gqlorm hide appears on a line within multiline documentation', () => {
    const model = makeModel(
      'Post',
      [makeField('id', 'scalar')],
      'This is a description\n@gqlorm hide',
    )

    const result = buildModelSchema(makeDmmf([model]))

    expect(result).not.toHaveProperty('post')
  })

  it('excludes unsupported kind fields from the output', () => {
    const model = makeModel('Post', [
      makeField('id', 'scalar'),
      makeField('weirdField', 'unsupported'),
    ])

    const result = buildModelSchema(makeDmmf([model]))

    expect(result.post).toEqual(['id'])
    expect(result.post).not.toContain('weirdField')
  })

  it('includes a sensitive-named field when @gqlorm show appears in multiline field documentation', () => {
    const model = makeModel('Post', [
      makeField('id', 'scalar'),
      makeField('resetToken', 'scalar', 'Field description\n@gqlorm show'),
    ])

    const result = buildModelSchema(makeDmmf([model]))

    expect(result.post).toContain('resetToken')
  })
})

// ---------------------------------------------------------------------------
// Integration tests — generateGqlormArtifacts (uses test-project-live fixture)
// ---------------------------------------------------------------------------
//
// We mock `getPrismaSchemas` to read the schema file directly, bypassing the
// project's prisma.config.cjs (which requires env vars that may not be set in
// unit-test environments). All other behaviour — DMMF parsing, visibility
// rules, file writing — is exercised for real.
// ---------------------------------------------------------------------------

const FIXTURE_PATH = path.resolve(
  __dirname,
  '../../../../__fixtures__/test-project-live',
)

const FIXTURE_SCHEMA_PATH = path.join(
  FIXTURE_PATH,
  'api',
  'db',
  'schema.prisma',
)

vi.mock('@cedarjs/project-config', async (importOriginal) => {
  const original = await importOriginal<typeof ProjectConfig>()

  return {
    ...original,
    getPrismaSchemas: async () => {
      const content = fs.readFileSync(FIXTURE_SCHEMA_PATH, 'utf-8')
      return {
        schemas: [[FIXTURE_SCHEMA_PATH, content]] as [string, string][],
        schemaRootDir: path.dirname(FIXTURE_SCHEMA_PATH),
      }
    },
  }
})

describe('generateGqlormArtifacts - integration', () => {
  let outputPath: string

  beforeAll(async () => {
    process.env.CEDAR_CWD = FIXTURE_PATH
    outputPath = path.join(getPaths().generated.base, 'gqlorm-schema.json')

    const { files, errors } = await generateGqlormArtifacts()
    expect(errors).toEqual([])
    expect(files).toHaveLength(1)
    expect(files[0]).toEqual(outputPath)
  })

  afterAll(() => {
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath)
    }

    delete process.env.CEDAR_CWD
  })

  it('writes gqlorm-schema.json to the generated base dir and returns the path', async () => {
    expect(fs.existsSync(outputPath)).toBe(true)

    const raw = fs.readFileSync(outputPath, 'utf-8')
    expect(() => JSON.parse(raw)).not.toThrow()
  })

  it('post fields include only scalar/enum fields and exclude the author relation', () => {
    const schema = JSON.parse(fs.readFileSync(outputPath, 'utf-8'))

    expect(schema.post).toEqual([
      'id',
      'title',
      'body',
      'authorId',
      'createdAt',
    ])
  })

  it('user sensitive fields are excluded from the schema', () => {
    const schema = JSON.parse(fs.readFileSync(outputPath, 'utf-8'))

    expect(schema.user).not.toContain('hashedPassword')
    expect(schema.user).not.toContain('salt')
    expect(schema.user).not.toContain('resetToken')
    expect(schema.user).not.toContain('resetTokenExpiresAt')
  })

  it('user non-sensitive fields are present in the schema', () => {
    const schema = JSON.parse(fs.readFileSync(outputPath, 'utf-8'))

    expect(schema.user).toContain('id')
    expect(schema.user).toContain('email')
    expect(schema.user).toContain('fullName')
  })

  it('contact fields are complete and correct', () => {
    const schema = JSON.parse(fs.readFileSync(outputPath, 'utf-8'))

    expect(schema.contact).toEqual([
      'id',
      'name',
      'email',
      'message',
      'createdAt',
    ])
  })

  it('emits console.warn for each sensitive field found in the User model', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await generateGqlormArtifacts()

    // hashedPassword (password), salt (salt), resetToken (token),
    // resetTokenExpiresAt (token) — four sensitive fields in the User model.
    expect(warnSpy).toHaveBeenCalledTimes(4)

    warnSpy.mockRestore()
  })
})
