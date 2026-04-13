import fs from 'node:fs'
import path from 'node:path'

import type { Document, Field, FieldKind, Model } from '@prisma/dmmf'
import {
  afterAll,
  beforeAll,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import type * as ProjectConfig from '@cedarjs/project-config'
import { getPaths } from '@cedarjs/project-config'

import {
  buildModelSchema,
  buildBackendModelInfo,
  mapDmmfTypeToGraphql,
  getExistingSdlTypeNames,
  generateGqlormSdlContent,
  generateGqlormBackendContent,
  generateGqlormArtifacts,
} from '../generate/gqlormSchema.js'

function makeField(
  name: string,
  kind: FieldKind = 'scalar',
  documentation?: string,
  overrides?: Partial<Field>,
) {
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
    ...overrides,
  } satisfies Field
}

function makeModel(name: string, fields: Field[], documentation?: string) {
  return {
    name,
    dbName: null,
    schema: null,
    fields,
    uniqueFields: [],
    uniqueIndexes: [],
    primaryKey: null,
    documentation,
  } satisfies Model
}

function makeDmmf(models: Model[]) {
  return {
    datamodel: {
      models,
      enums: [],
      types: [],
      indexes: [],
    },
    // We only mock what we need for the test
  } as unknown as Document
}

// ---------------------------------------------------------------------------
// buildModelSchema (existing tests — unchanged)
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

  it('skips framework internal models but keeps other models', () => {
    const idField = makeField('id', 'scalar')
    const rwMigration = makeModel('RW_DataMigration', [idField])
    const contact = makeModel('Contact', [idField, makeField('name', 'scalar')])

    const result = buildModelSchema(makeDmmf([rwMigration, contact]))

    expect(result).not.toHaveProperty('rW_DataMigration')
    expect(result).toHaveProperty('contact')
  })

  it('uses camelCase model names as keys in the returned record', () => {
    const model = makeModel('BlogPost', [makeField('id', 'scalar')])

    const result = buildModelSchema(makeDmmf([model]))

    expect(result).toHaveProperty('blogPost')
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
// mapDmmfTypeToGraphql
// ---------------------------------------------------------------------------

describe('mapDmmfTypeToGraphql', () => {
  it('maps String to String', () => {
    expect(mapDmmfTypeToGraphql('String', 'scalar')).toBe('String')
  })

  it('maps Int to Int', () => {
    expect(mapDmmfTypeToGraphql('Int', 'scalar')).toBe('Int')
  })

  it('maps Float to Float', () => {
    expect(mapDmmfTypeToGraphql('Float', 'scalar')).toBe('Float')
  })

  it('maps BigInt to BigInt', () => {
    expect(mapDmmfTypeToGraphql('BigInt', 'scalar')).toBe('BigInt')
  })

  it('maps Boolean to Boolean', () => {
    expect(mapDmmfTypeToGraphql('Boolean', 'scalar')).toBe('Boolean')
  })

  it('maps DateTime to DateTime', () => {
    expect(mapDmmfTypeToGraphql('DateTime', 'scalar')).toBe('DateTime')
  })

  it('maps Json to JSON', () => {
    expect(mapDmmfTypeToGraphql('Json', 'scalar')).toBe('JSON')
  })

  it('maps Decimal to String', () => {
    expect(mapDmmfTypeToGraphql('Decimal', 'scalar')).toBe('String')
  })

  it('maps Bytes to String', () => {
    expect(mapDmmfTypeToGraphql('Bytes', 'scalar')).toBe('String')
  })

  it('maps enum fields to String regardless of the type name', () => {
    expect(mapDmmfTypeToGraphql('Status', 'enum')).toBe('String')
    expect(mapDmmfTypeToGraphql('Role', 'enum')).toBe('String')
  })

  it('falls back to String for unknown scalar types', () => {
    expect(mapDmmfTypeToGraphql('UnknownThing', 'scalar')).toBe('String')
  })
})

// ---------------------------------------------------------------------------
// buildBackendModelInfo
// ---------------------------------------------------------------------------

describe('buildBackendModelInfo', () => {
  it('returns enriched model info with field types and id flag', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const model = makeModel('Todo', [
      makeField('id', 'scalar', undefined, {
        type: 'Int',
        isId: true,
      }),
      makeField('title', 'scalar', undefined, { type: 'String' }),
      makeField('done', 'scalar', undefined, { type: 'Boolean' }),
      makeField('createdAt', 'scalar', undefined, { type: 'DateTime' }),
    ])

    const result = buildBackendModelInfo(makeDmmf([model]))

    expect(result).toHaveLength(1)
    expect(result[0].modelName).toBe('Todo')
    expect(result[0].camelName).toBe('todo')
    expect(result[0].pluralName).toBe('todos')
    expect(result[0].fields).toEqual([
      { name: 'id', graphqlType: 'Int', isRequired: true, isId: true },
      { name: 'title', graphqlType: 'String', isRequired: true, isId: false },
      {
        name: 'done',
        graphqlType: 'Boolean',
        isRequired: true,
        isId: false,
      },
      {
        name: 'createdAt',
        graphqlType: 'DateTime',
        isRequired: true,
        isId: false,
      },
    ])
    expect(result[0].idField).toEqual({
      name: 'id',
      graphqlType: 'Int',
      isRequired: true,
      isId: true,
    })

    warnSpy.mockRestore()
  })

  it('skips models with @gqlorm hide directive', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const model = makeModel(
      'InternalThing',
      [makeField('id', 'scalar', undefined, { type: 'Int', isId: true })],
      '@gqlorm hide',
    )

    const result = buildBackendModelInfo(makeDmmf([model]))

    expect(result).toHaveLength(0)

    warnSpy.mockRestore()
  })

  it('skips internal migration models', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const model = makeModel('RW_DataMigration', [
      makeField('id', 'scalar', undefined, { type: 'Int', isId: true }),
      makeField('state', 'scalar'),
    ])

    const result = buildBackendModelInfo(makeDmmf([model]))

    expect(result).toHaveLength(0)

    warnSpy.mockRestore()
  })

  it('excludes relation (object) fields from the output', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const model = makeModel('Post', [
      makeField('id', 'scalar', undefined, { type: 'Int', isId: true }),
      makeField('title', 'scalar'),
      makeField('author', 'object'),
    ])

    const result = buildBackendModelInfo(makeDmmf([model]))

    expect(result).toHaveLength(1)
    const fieldNames = result[0].fields.map((f) => f.name)
    expect(fieldNames).toContain('id')
    expect(fieldNames).toContain('title')
    expect(fieldNames).not.toContain('author')

    warnSpy.mockRestore()
  })

  it('excludes fields with @gqlorm hide', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const model = makeModel('Post', [
      makeField('id', 'scalar', undefined, { type: 'Int', isId: true }),
      makeField('secret', 'scalar', '@gqlorm hide'),
    ])

    const result = buildBackendModelInfo(makeDmmf([model]))

    expect(result).toHaveLength(1)
    const fieldNames = result[0].fields.map((f) => f.name)
    expect(fieldNames).not.toContain('secret')

    warnSpy.mockRestore()
  })

  it('includes @gqlorm show fields even if they match sensitivity heuristic', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const model = makeModel('ApiKey', [
      makeField('id', 'scalar', undefined, { type: 'Int', isId: true }),
      makeField('keyPrefix', 'scalar', '@gqlorm show'),
    ])

    const result = buildBackendModelInfo(makeDmmf([model]))

    expect(result).toHaveLength(1)
    const fieldNames = result[0].fields.map((f) => f.name)
    expect(fieldNames).toContain('keyPrefix')

    warnSpy.mockRestore()
  })

  it('excludes sensitive fields automatically', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const model = makeModel('User', [
      makeField('id', 'scalar', undefined, { type: 'String', isId: true }),
      makeField('email', 'scalar'),
      makeField('hashedPassword', 'scalar'),
      makeField('salt', 'scalar'),
    ])

    const result = buildBackendModelInfo(makeDmmf([model]))

    expect(result).toHaveLength(1)
    const fieldNames = result[0].fields.map((f) => f.name)
    expect(fieldNames).toContain('id')
    expect(fieldNames).toContain('email')
    expect(fieldNames).not.toContain('hashedPassword')
    expect(fieldNames).not.toContain('salt')

    warnSpy.mockRestore()
  })

  it('maps nullable fields correctly', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const model = makeModel('Todo', [
      makeField('id', 'scalar', undefined, { type: 'Int', isId: true }),
      makeField('body', 'scalar', undefined, {
        type: 'String',
        isRequired: false,
      }),
    ])

    const result = buildBackendModelInfo(makeDmmf([model]))

    expect(result[0].fields[1]).toEqual({
      name: 'body',
      graphqlType: 'String',
      isRequired: false,
      isId: false,
    })

    warnSpy.mockRestore()
  })

  it('sets idField to undefined when model has no @id field', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const model = makeModel('NoId', [
      makeField('name', 'scalar'),
      makeField('value', 'scalar'),
    ])

    const result = buildBackendModelInfo(makeDmmf([model]))

    expect(result).toHaveLength(1)
    expect(result[0].idField).toBeUndefined()

    warnSpy.mockRestore()
  })

  it('maps enum kind fields to String graphqlType', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const model = makeModel('Post', [
      makeField('id', 'scalar', undefined, { type: 'Int', isId: true }),
      makeField('status', 'enum', undefined, { type: 'PostStatus' }),
    ])

    const result = buildBackendModelInfo(makeDmmf([model]))

    const statusField = result[0].fields.find((f) => f.name === 'status')
    expect(statusField?.graphqlType).toBe('String')

    warnSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// getExistingSdlTypeNames
// ---------------------------------------------------------------------------

describe('getExistingSdlTypeNames', () => {
  let tmpDir: string

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(path.resolve(), '.gqlorm-test-'))
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns an empty set when the directory does not exist', () => {
    const result = getExistingSdlTypeNames('/nonexistent/path')
    expect(result.size).toBe(0)
  })

  it('extracts type names from SDL files', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'posts.sdl.ts'),
      `
export const schema = gql\`
  type Post {
    id: Int!
    title: String!
  }

  type Query {
    posts: [Post!]! @skipAuth
  }
\`
`,
    )

    const result = getExistingSdlTypeNames(tmpDir)

    expect(result.has('Post')).toBe(true)
    // Query is a structural type and should be excluded
    expect(result.has('Query')).toBe(false)
  })

  it('extracts multiple type names from a single file', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'multi.sdl.ts'),
      `
export const schema = gql\`
  type Author {
    id: String!
    name: String!
  }

  type Book {
    id: Int!
    title: String!
    author: Author!
  }

  type Query {
    authors: [Author!]!
    books: [Book!]!
  }

  type Mutation {
    createBook(title: String!): Book!
  }
\`
`,
    )

    const result = getExistingSdlTypeNames(tmpDir)

    expect(result.has('Author')).toBe(true)
    expect(result.has('Book')).toBe(true)
    expect(result.has('Query')).toBe(false)
    expect(result.has('Mutation')).toBe(false)
  })

  it('ignores the __gqlorm__.sdl.ts file', () => {
    fs.writeFileSync(
      path.join(tmpDir, '__gqlorm__.sdl.ts'),
      `
export const schema = gql\`
  type Todo {
    id: Int!
  }
  type Query {
    todos: [Todo!]!
  }
\`
`,
    )

    const result = getExistingSdlTypeNames(tmpDir)

    // Todo comes from __gqlorm__.sdl.ts which should be ignored
    expect(result.has('Todo')).toBe(false)
    // But Post and others from previous test files should still be found
    expect(result.has('Post')).toBe(true)
  })

  it('handles .sdl.js files as well', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'tags.sdl.js'),
      `
export const schema = gql\`
  type Tag {
    id: Int!
    label: String!
  }
  type Query {
    tags: [Tag!]!
  }
\`
`,
    )

    const result = getExistingSdlTypeNames(tmpDir)

    expect(result.has('Tag')).toBe(true)
  })

  it('excludes Subscription as a structural type', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'subs.sdl.ts'),
      `
export const schema = gql\`
  type Subscription {
    newMessage: Message!
  }
  type Message {
    id: Int!
    text: String!
  }
\`
`,
    )

    const result = getExistingSdlTypeNames(tmpDir)

    expect(result.has('Message')).toBe(true)
    expect(result.has('Subscription')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// generateGqlormSdlContent
// ---------------------------------------------------------------------------

describe('generateGqlormSdlContent', () => {
  it('returns an empty string when there are no models', () => {
    const result = generateGqlormSdlContent([])
    expect(result).toBe('')
  })

  it('generates valid SDL content for a single model', () => {
    const content = generateGqlormSdlContent([
      {
        modelName: 'Todo',
        camelName: 'todo',
        pluralName: 'todos',
        fields: [
          { name: 'id', graphqlType: 'Int', isRequired: true, isId: true },
          {
            name: 'title',
            graphqlType: 'String',
            isRequired: true,
            isId: false,
          },
          {
            name: 'done',
            graphqlType: 'Boolean',
            isRequired: true,
            isId: false,
          },
        ],
        idField: {
          name: 'id',
          graphqlType: 'Int',
          isRequired: true,
          isId: true,
        },
      },
    ])

    // Header comment
    expect(content).toContain('auto-generated by Cedar gqlorm')
    expect(content).toContain('Do not edit')

    // db import
    expect(content).toContain("import { db } from 'src/lib/db'")

    // Type definition
    expect(content).toContain('type Todo {')
    expect(content).toContain('id: Int!')
    expect(content).toContain('title: String!')
    expect(content).toContain('done: Boolean!')

    // Query fields
    expect(content).toContain('todos: [Todo!]! @skipAuth')
    expect(content).toContain('todo(id: Int!): Todo @skipAuth')

    // Resolver: findMany
    expect(content).toContain('todos: () => {')
    expect(content).toContain('db.todo.findMany(')
    expect(content).toContain('id: true, title: true, done: true')

    // Resolver: findUnique
    expect(content).toContain(
      'todo: (_root: unknown, { id }: { id: number }) => {',
    )
    expect(content).toContain('db.todo.findUnique(')
    expect(content).toContain('where: { id }')
  })

  it('handles nullable fields without the ! suffix', () => {
    const content = generateGqlormSdlContent([
      {
        modelName: 'Post',
        camelName: 'post',
        pluralName: 'posts',
        fields: [
          { name: 'id', graphqlType: 'Int', isRequired: true, isId: true },
          {
            name: 'body',
            graphqlType: 'String',
            isRequired: false,
            isId: false,
          },
        ],
        idField: {
          name: 'id',
          graphqlType: 'Int',
          isRequired: true,
          isId: true,
        },
      },
    ])

    // body should NOT have ! (nullable)
    expect(content).toMatch(/body: String\b[^!]/)
    // id should have !
    expect(content).toContain('id: Int!')
  })

  it('generates content for multiple models', () => {
    const content = generateGqlormSdlContent([
      {
        modelName: 'Todo',
        camelName: 'todo',
        pluralName: 'todos',
        fields: [
          { name: 'id', graphqlType: 'Int', isRequired: true, isId: true },
          {
            name: 'title',
            graphqlType: 'String',
            isRequired: true,
            isId: false,
          },
        ],
        idField: {
          name: 'id',
          graphqlType: 'Int',
          isRequired: true,
          isId: true,
        },
      },
      {
        modelName: 'Tag',
        camelName: 'tag',
        pluralName: 'tags',
        fields: [
          { name: 'id', graphqlType: 'Int', isRequired: true, isId: true },
          {
            name: 'label',
            graphqlType: 'String',
            isRequired: true,
            isId: false,
          },
        ],
        idField: {
          name: 'id',
          graphqlType: 'Int',
          isRequired: true,
          isId: true,
        },
      },
    ])

    // Both types present
    expect(content).toContain('type Todo {')
    expect(content).toContain('type Tag {')

    // Both query fields present
    expect(content).toContain('todos: [Todo!]! @skipAuth')
    expect(content).toContain('tags: [Tag!]! @skipAuth')

    // Both resolvers present
    expect(content).toContain('db.todo.findMany(')
    expect(content).toContain('db.tag.findMany(')
  })

  it('omits findUnique when model has no id field', () => {
    const content = generateGqlormSdlContent([
      {
        modelName: 'ViewOnly',
        camelName: 'viewOnly',
        pluralName: 'viewOnlys',
        fields: [
          {
            name: 'name',
            graphqlType: 'String',
            isRequired: true,
            isId: false,
          },
        ],
        idField: undefined,
      },
    ])

    // findMany should be present
    expect(content).toContain('viewOnlys: [ViewOnly!]! @skipAuth')

    // findUnique should NOT be present (no id field)
    expect(content).not.toContain('viewOnly(id:')
  })

  it('uses correct TypeScript type for String id fields', () => {
    const content = generateGqlormSdlContent([
      {
        modelName: 'Account',
        camelName: 'account',
        pluralName: 'accounts',
        fields: [
          { name: 'id', graphqlType: 'String', isRequired: true, isId: true },
          {
            name: 'name',
            graphqlType: 'String',
            isRequired: true,
            isId: false,
          },
        ],
        idField: {
          name: 'id',
          graphqlType: 'String',
          isRequired: true,
          isId: true,
        },
      },
    ])

    // SDL: String! for id argument
    expect(content).toContain('account(id: String!): Account @skipAuth')
    // TS: string type for id parameter
    expect(content).toContain('{ id }: { id: string }')
  })
})

// ---------------------------------------------------------------------------
// generateGqlormBackendContent
// ---------------------------------------------------------------------------

describe('generateGqlormBackendContent', () => {
  it('returns an empty string when there are no models', () => {
    const result = generateGqlormBackendContent([])
    expect(result).toBe('')
  })

  it('generates backend content for a single model', () => {
    const content = generateGqlormBackendContent([
      {
        modelName: 'Todo',
        camelName: 'todo',
        pluralName: 'todos',
        fields: [
          { name: 'id', graphqlType: 'Int', isRequired: true, isId: true },
          {
            name: 'title',
            graphqlType: 'String',
            isRequired: true,
            isId: false,
          },
          {
            name: 'done',
            graphqlType: 'Boolean',
            isRequired: true,
            isId: false,
          },
        ],
        idField: {
          name: 'id',
          graphqlType: 'Int',
          isRequired: true,
          isId: true,
        },
      },
    ])

    // Header comment
    expect(content).toContain('auto-generated by Cedar gqlorm')
    expect(content).toContain('Do not edit')

    // Must NOT import db directly (the comment in the file mentions src/lib/db
    // and @prisma/client but must not contain actual import statements for them)
    expect(content).not.toMatch(/^import .* from 'src\/lib\/db'/m)
    expect(content).not.toMatch(/^import .* from '@prisma\/client'/m)

    // Must import graphql-tag
    expect(content).toContain("import gql from 'graphql-tag'")

    // GqlormDb interface
    expect(content).toContain('interface GqlormDb {')
    expect(content).toContain('todo: {')
    expect(content).toContain('findMany(args: {')
    expect(content).toContain('findUnique(args: {')
    expect(content).toContain('id: number')
    expect(content).toContain('title: string')
    expect(content).toContain('done: boolean')

    // Type definition
    expect(content).toContain('type Todo {')
    expect(content).toContain('id: Int!')
    expect(content).toContain('title: String!')
    expect(content).toContain('done: Boolean!')

    // Query fields
    expect(content).toContain('todos: [Todo!]! @skipAuth')
    expect(content).toContain('todo(id: Int!): Todo @skipAuth')

    // Factory function
    expect(content).toContain(
      'export function createGqlormResolvers(db: GqlormDb)',
    )

    // Resolver: findMany
    expect(content).toContain('todos: () => {')
    expect(content).toContain('db.todo.findMany(')

    // Resolver: findUnique
    expect(content).toContain(
      'todo: (_root: unknown, { id }: { id: number }) => {',
    )
    expect(content).toContain('db.todo.findUnique(')
    expect(content).toContain('where: { id }')
  })

  it('handles nullable fields without the ! suffix and uses | null in interface', () => {
    const content = generateGqlormBackendContent([
      {
        modelName: 'Post',
        camelName: 'post',
        pluralName: 'posts',
        fields: [
          { name: 'id', graphqlType: 'Int', isRequired: true, isId: true },
          {
            name: 'body',
            graphqlType: 'String',
            isRequired: false,
            isId: false,
          },
        ],
        idField: {
          name: 'id',
          graphqlType: 'Int',
          isRequired: true,
          isId: true,
        },
      },
    ])

    // body should NOT have ! (nullable)
    expect(content).toMatch(/body: String\b[^!]/)
    // id should have !
    expect(content).toContain('id: Int!')
    // Interface type: nullable field has | null
    expect(content).toContain('body: string | null')
  })

  it('maps DateTime to Date in the GqlormDb interface', () => {
    const content = generateGqlormBackendContent([
      {
        modelName: 'Event',
        camelName: 'event',
        pluralName: 'events',
        fields: [
          { name: 'id', graphqlType: 'Int', isRequired: true, isId: true },
          {
            name: 'createdAt',
            graphqlType: 'DateTime',
            isRequired: true,
            isId: false,
          },
        ],
        idField: {
          name: 'id',
          graphqlType: 'Int',
          isRequired: true,
          isId: true,
        },
      },
    ])

    // GraphQL SDL type
    expect(content).toContain('createdAt: DateTime!')
    // TypeScript interface type
    expect(content).toContain('createdAt: Date')
  })

  it('omits findUnique when model has no id field', () => {
    const content = generateGqlormBackendContent([
      {
        modelName: 'ViewOnly',
        camelName: 'viewOnly',
        pluralName: 'viewOnlys',
        fields: [
          {
            name: 'name',
            graphqlType: 'String',
            isRequired: true,
            isId: false,
          },
        ],
        idField: undefined,
      },
    ])

    // findMany should be present
    expect(content).toContain('viewOnlys: [ViewOnly!]! @skipAuth')
    // findUnique should NOT be present (no id field)
    expect(content).not.toContain('viewOnly(id:')
    expect(content).not.toContain('findUnique')
  })

  it('uses correct TypeScript type for String id fields', () => {
    const content = generateGqlormBackendContent([
      {
        modelName: 'Account',
        camelName: 'account',
        pluralName: 'accounts',
        fields: [
          { name: 'id', graphqlType: 'String', isRequired: true, isId: true },
          {
            name: 'name',
            graphqlType: 'String',
            isRequired: true,
            isId: false,
          },
        ],
        idField: {
          name: 'id',
          graphqlType: 'String',
          isRequired: true,
          isId: true,
        },
      },
    ])

    // SDL: String! for id argument
    expect(content).toContain('account(id: String!): Account @skipAuth')
    // TS: string type for id parameter
    expect(content).toContain('{ id }: { id: string }')
  })

  it('generates content for multiple models', () => {
    const content = generateGqlormBackendContent([
      {
        modelName: 'Todo',
        camelName: 'todo',
        pluralName: 'todos',
        fields: [
          { name: 'id', graphqlType: 'Int', isRequired: true, isId: true },
          {
            name: 'title',
            graphqlType: 'String',
            isRequired: true,
            isId: false,
          },
        ],
        idField: {
          name: 'id',
          graphqlType: 'Int',
          isRequired: true,
          isId: true,
        },
      },
      {
        modelName: 'Tag',
        camelName: 'tag',
        pluralName: 'tags',
        fields: [
          { name: 'id', graphqlType: 'Int', isRequired: true, isId: true },
          {
            name: 'label',
            graphqlType: 'String',
            isRequired: true,
            isId: false,
          },
        ],
        idField: {
          name: 'id',
          graphqlType: 'Int',
          isRequired: true,
          isId: true,
        },
      },
    ])

    // Both types present in SDL
    expect(content).toContain('type Todo {')
    expect(content).toContain('type Tag {')

    // Both entries in GqlormDb interface
    expect(content).toContain('todo: {')
    expect(content).toContain('tag: {')

    // Both query fields present
    expect(content).toContain('todos: [Todo!]! @skipAuth')
    expect(content).toContain('tags: [Tag!]! @skipAuth')

    // Both resolvers present
    expect(content).toContain('db.todo.findMany(')
    expect(content).toContain('db.tag.findMany(')
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
  let schemaOutputPath: string
  let backendOutputPath: string

  beforeAll(async () => {
    process.env.CEDAR_CWD = FIXTURE_PATH
    schemaOutputPath = path.join(
      getPaths().generated.base,
      'gqlorm-schema.json',
    )
    backendOutputPath = path.join(
      getPaths().generated.base,
      'gqlorm',
      'backend.ts',
    )

    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { files, errors } = await generateGqlormArtifacts()

    expect(errors).toEqual([])
    // Should produce the JSON schema file + the SDL file
    expect(files.length).toBeGreaterThanOrEqual(1)
    expect(files).toContain(schemaOutputPath)
    expect(files).toContain(backendOutputPath)

    vi.mocked(console).warn.mockClear()
  })

  afterAll(() => {
    vi.mocked(console).warn.mockRestore()

    if (fs.existsSync(schemaOutputPath)) {
      fs.unlinkSync(schemaOutputPath)
    }

    if (fs.existsSync(backendOutputPath)) {
      fs.unlinkSync(backendOutputPath)
    }

    delete process.env.CEDAR_CWD
  })

  afterEach(() => {
    vi.mocked(console).warn.mockClear()
  })

  it('writes gqlorm-schema.json to the generated base dir and returns the path', async () => {
    expect(fs.existsSync(schemaOutputPath)).toBe(true)

    const raw = fs.readFileSync(schemaOutputPath, 'utf-8')
    expect(() => JSON.parse(raw)).not.toThrow()
  })

  it('post fields include only scalar/enum fields and exclude the author relation', () => {
    const schema = JSON.parse(fs.readFileSync(schemaOutputPath, 'utf-8'))

    expect(schema.post).toEqual([
      'id',
      'title',
      'body',
      'authorId',
      'createdAt',
    ])
  })

  it('user sensitive fields are excluded from the schema', () => {
    const schema = JSON.parse(fs.readFileSync(schemaOutputPath, 'utf-8'))

    expect(schema.user).not.toContain('hashedPassword')
    expect(schema.user).not.toContain('salt')
    expect(schema.user).not.toContain('resetToken')
    expect(schema.user).not.toContain('resetTokenExpiresAt')
  })

  it('user non-sensitive fields are present in the schema', () => {
    const schema = JSON.parse(fs.readFileSync(schemaOutputPath, 'utf-8'))

    expect(schema.user).toContain('id')
    expect(schema.user).toContain('email')
    expect(schema.user).toContain('fullName')
  })

  it('contact fields are complete and correct', () => {
    const schema = JSON.parse(fs.readFileSync(schemaOutputPath, 'utf-8'))

    expect(schema.contact).toEqual([
      'id',
      'name',
      'email',
      'message',
      'createdAt',
    ])
  })

  it('todo fields are present in the schema', () => {
    const schema = JSON.parse(fs.readFileSync(schemaOutputPath, 'utf-8'))

    expect(schema.todo).toEqual(['id', 'title', 'body', 'done', 'createdAt'])
  })

  it('emits console.warn for each sensitive field found in the User model', async () => {
    await generateGqlormArtifacts()

    // hashedPassword (password), salt (salt), resetToken (token),
    // resetTokenExpiresAt (token) — four sensitive fields in the User model.
    expect(vi.mocked(console).warn).toHaveBeenCalledTimes(4)
  })

  it('writes backend.ts to .cedar/gqlorm/ and returns the path', () => {
    expect(fs.existsSync(backendOutputPath)).toBe(true)
  })

  it('generated backend.ts contains Todo type (no manual SDL exists for Todo)', () => {
    const content = fs.readFileSync(backendOutputPath, 'utf-8')

    expect(content).toContain('type Todo {')
    expect(content).toContain('todos: [Todo!]! @skipAuth')
    expect(content).toContain('todo(id: Int!): Todo @skipAuth')
    expect(content).toContain('db.todo.findMany(')
  })

  it('generated backend.ts contains UserExample type (no manual SDL exists for UserExample)', () => {
    const content = fs.readFileSync(backendOutputPath, 'utf-8')

    expect(content).toContain('type UserExample {')
    expect(content).toContain('userExamples: [UserExample!]! @skipAuth')
  })

  it('generated backend.ts does NOT contain Post type (manual SDL exists)', () => {
    const content = fs.readFileSync(backendOutputPath, 'utf-8')

    expect(content).not.toContain('type Post {')
    expect(content).not.toContain('posts: [Post!]!')
  })

  it('generated backend.ts does NOT contain User type (manual SDL exists)', () => {
    const content = fs.readFileSync(backendOutputPath, 'utf-8')

    expect(content).not.toContain('type User {')
  })

  it('generated backend.ts does NOT contain Contact type (manual SDL exists)', () => {
    const content = fs.readFileSync(backendOutputPath, 'utf-8')

    expect(content).not.toContain('type Contact {')
  })

  it('generated backend.ts has the auto-generated header comment', () => {
    const content = fs.readFileSync(backendOutputPath, 'utf-8')

    expect(content).toContain('auto-generated by Cedar gqlorm')
    expect(content).toContain('Do not edit')
  })

  it('generated backend.ts exports createGqlormResolvers factory function', () => {
    const content = fs.readFileSync(backendOutputPath, 'utf-8')

    expect(content).toContain(
      'export function createGqlormResolvers(db: GqlormDb)',
    )
  })

  it('generated backend.ts does NOT import from src/lib/db or @prisma/client', () => {
    const content = fs.readFileSync(backendOutputPath, 'utf-8')

    // The generated file contains comments mentioning src/lib/db and
    // @prisma/client but must not contain actual import statements for them
    expect(content).not.toMatch(/^import .* from 'src\/lib\/db'/m)
    expect(content).not.toMatch(/^import .* from '@prisma\/client'/m)
  })

  it('generated backend.ts contains the GqlormDb interface', () => {
    const content = fs.readFileSync(backendOutputPath, 'utf-8')

    expect(content).toContain('interface GqlormDb {')
  })
})
