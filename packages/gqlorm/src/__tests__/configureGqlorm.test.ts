import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { GraphQLGenerator } from '../generator/graphqlGenerator.js'
import { QueryBuilder, queryBuilder } from '../queryBuilder.js'
import { configureGqlorm } from '../setup.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal QueryAST for a findMany operation so we can drive the
 * generator directly without going through the full parser pipeline.
 */
function makeFindManyAST(model: string) {
  return {
    type: 'Query' as const,
    model,
    operation: 'findMany' as const,
    args: undefined,
    isLive: false,
  }
}

// ---------------------------------------------------------------------------
// GraphQLGenerator.setSchema()
// ---------------------------------------------------------------------------

describe('GraphQLGenerator.setSchema()', () => {
  it('switches from id-only fallback to schema fields after setSchema()', () => {
    const generator = new GraphQLGenerator()

    // Before any schema: only `id` selected
    const before = generator.generate(makeFindManyAST('post'))
    expect(before.query).toContain('id')
    expect(before.query).not.toContain('title')
    expect(before.query).not.toContain('body')

    // Apply schema
    generator.setSchema({ post: ['id', 'title', 'body'] })

    const after = generator.generate(makeFindManyAST('post'))
    expect(after.query).toContain('id')
    expect(after.query).toContain('title')
    expect(after.query).toContain('body')
  })

  it('reverts to id-only fallback when setSchema(undefined) is called', () => {
    const generator = new GraphQLGenerator({ post: ['id', 'title', 'body'] })

    const withSchema = generator.generate(makeFindManyAST('post'))
    expect(withSchema.query).toContain('title')

    generator.setSchema(undefined)

    const afterReset = generator.generate(makeFindManyAST('post'))
    expect(afterReset.query).toContain('id')
    expect(afterReset.query).not.toContain('title')
    expect(afterReset.query).not.toContain('body')
  })

  it('last setSchema() call wins when called multiple times', () => {
    const generator = new GraphQLGenerator()

    generator.setSchema({ post: ['id', 'title'] })
    generator.setSchema({ post: ['id', 'title', 'body', 'createdAt'] })

    const result = generator.generate(makeFindManyAST('post'))
    expect(result.query).toContain('id')
    expect(result.query).toContain('title')
    expect(result.query).toContain('body')
    expect(result.query).toContain('createdAt')
  })

  it('uses only the fields for the queried model, ignoring other model entries', () => {
    const generator = new GraphQLGenerator({
      post: ['id', 'title', 'body'],
      user: ['id', 'email', 'fullName'],
    })

    const postResult = generator.generate(makeFindManyAST('post'))
    expect(postResult.query).toContain('title')
    expect(postResult.query).toContain('body')
    expect(postResult.query).not.toContain('email')
    expect(postResult.query).not.toContain('fullName')

    const userResult = generator.generate(makeFindManyAST('user'))
    expect(userResult.query).toContain('email')
    expect(userResult.query).toContain('fullName')
    expect(userResult.query).not.toContain('title')
    expect(userResult.query).not.toContain('body')
  })

  it('falls back to id-only when the schema has no entry for the queried model', () => {
    const generator = new GraphQLGenerator({ user: ['id', 'email'] })

    // post has no entry in the schema
    const result = generator.generate(makeFindManyAST('post'))
    expect(result.query).toContain('id')
    expect(result.query).not.toContain('email')
  })
})

// ---------------------------------------------------------------------------
// QueryBuilder.configure()
// ---------------------------------------------------------------------------

describe('QueryBuilder.configure()', () => {
  it('updates field selection for subsequent queries', () => {
    const qb = new QueryBuilder()

    const before = qb.build('user', 'findMany')
    expect(before.query).toContain('id')
    expect(before.query).not.toContain('email')
    expect(before.query).not.toContain('fullName')

    qb.configure({ schema: { user: ['id', 'email', 'fullName'] } })

    const after = qb.build('user', 'findMany')
    expect(after.query).toContain('id')
    expect(after.query).toContain('email')
    expect(after.query).toContain('fullName')
  })

  it('is non-destructive to other existing options', () => {
    const qb = new QueryBuilder({ forceLiveQueries: true })

    qb.configure({ schema: { user: ['id', 'email'] } })

    const result = qb.build('user', 'findMany')
    // forceLiveQueries must still be in effect
    expect(result.query).toContain('@live')
    // schema fields must also be present
    expect(result.query).toContain('email')
  })

  it('last configure() call wins when called multiple times', () => {
    const qb = new QueryBuilder()

    qb.configure({ schema: { post: ['id', 'title'] } })
    qb.configure({ schema: { post: ['id', 'title', 'body', 'authorId'] } })

    const result = qb.build('post', 'findMany')
    expect(result.query).toContain('id')
    expect(result.query).toContain('title')
    expect(result.query).toContain('body')
    expect(result.query).toContain('authorId')
  })

  it('explicit select always overrides schema-based field selection', () => {
    const qb = new QueryBuilder()
    qb.configure({ schema: { post: ['id', 'title', 'body'] } })

    const result = qb.build('post', 'findMany', {
      select: { id: true, title: true },
    })

    expect(result.query).toContain('id')
    expect(result.query).toContain('title')
    // body is in the schema but NOT in the explicit select — must be absent
    expect(result.query).not.toContain('body')
  })

  it('passing schema: undefined via configure() reverts to id-only fallback', () => {
    const qb = new QueryBuilder({ schema: { post: ['id', 'title', 'body'] } })

    const withSchema = qb.build('post', 'findMany')
    expect(withSchema.query).toContain('title')

    qb.configure({ schema: undefined })

    const afterReset = qb.build('post', 'findMany')
    expect(afterReset.query).toContain('id')
    expect(afterReset.query).not.toContain('title')
    expect(afterReset.query).not.toContain('body')
  })

  it('configure() without a schema key does not clear an existing schema', () => {
    const qb = new QueryBuilder({ schema: { post: ['id', 'title', 'body'] } })

    // Configure with something unrelated — no `schema` key present at all
    qb.configure({ enableLiveQueries: true })

    const result = qb.build('post', 'findMany')
    // Schema must still be in effect
    expect(result.query).toContain('title')
    expect(result.query).toContain('body')
  })

  it('getOptions() reflects the merged options after configure()', () => {
    const qb = new QueryBuilder({ forceLiveQueries: true })

    qb.configure({ schema: { user: ['id', 'email'] } })

    const opts = qb.getOptions()
    expect(opts.forceLiveQueries).toBe(true)
    expect(opts.schema).toEqual({ user: ['id', 'email'] })
  })
})

// ---------------------------------------------------------------------------
// configureGqlorm() — singleton integration
// ---------------------------------------------------------------------------

describe('configureGqlorm()', () => {
  // Reset the global singleton before and after each test in this group so
  // tests do not bleed into each other.
  beforeEach(() => {
    configureGqlorm({ schema: undefined })
  })

  afterEach(() => {
    configureGqlorm({ schema: undefined })
  })

  it('makes schema-aware queries from the singleton queryBuilder', () => {
    configureGqlorm({
      schema: { post: ['id', 'title', 'body', 'createdAt'] },
    })

    const result = queryBuilder.build('post', 'findMany')
    expect(result.query).toContain('id')
    expect(result.query).toContain('title')
    expect(result.query).toContain('body')
    expect(result.query).toContain('createdAt')
  })

  it('uses the buildQueryFromFunction shorthand with the configured schema', () => {
    configureGqlorm({
      schema: {
        post: ['id', 'title', 'body', 'authorId', 'createdAt'],
        user: ['id', 'email', 'fullName'],
      },
    })

    const postResult = queryBuilder.buildFromFunction((db) =>
      db.post.findMany(),
    )
    expect(postResult.query).toContain('title')
    expect(postResult.query).toContain('body')
    expect(postResult.query).toContain('authorId')
    expect(postResult.query).toContain('createdAt')
    // user fields must not appear in a post query
    expect(postResult.query).not.toContain('email')

    const userResult = queryBuilder.buildFromFunction((db) =>
      db.user.findMany(),
    )
    expect(userResult.query).toContain('email')
    expect(userResult.query).toContain('fullName')
    // post fields must not appear in a user query
    expect(userResult.query).not.toContain('title')
  })

  it('falls back to id-only when configureGqlorm({ schema: undefined }) is called', () => {
    // First apply a schema so we know we are truly resetting
    configureGqlorm({ schema: { post: ['id', 'title', 'body'] } })

    // Now reset
    configureGqlorm({ schema: undefined })

    const result = queryBuilder.build('post', 'findMany')
    expect(result.query).toContain('id')
    expect(result.query).not.toContain('title')
    expect(result.query).not.toContain('body')
  })

  it('is idempotent — calling twice is safe and last call wins', () => {
    configureGqlorm({ schema: { post: ['id', 'title'] } })
    configureGqlorm({
      schema: { post: ['id', 'title', 'body', 'authorId', 'createdAt'] },
    })

    const result = queryBuilder.build('post', 'findMany')
    expect(result.query).toContain('id')
    expect(result.query).toContain('title')
    expect(result.query).toContain('body')
    expect(result.query).toContain('authorId')
    expect(result.query).toContain('createdAt')
  })

  it('explicit select still overrides the configured schema', () => {
    configureGqlorm({
      schema: { post: ['id', 'title', 'body', 'createdAt'] },
    })

    const result = queryBuilder.buildFromFunction((db) =>
      db.post.findMany({ select: { id: true, title: true } }),
    )

    expect(result.query).toContain('id')
    expect(result.query).toContain('title')
    // body and createdAt are in schema but NOT in explicit select
    expect(result.query).not.toContain('body')
    expect(result.query).not.toContain('createdAt')
  })

  it('does not affect queries for models not listed in the schema', () => {
    configureGqlorm({ schema: { post: ['id', 'title', 'body'] } })

    // `contact` is not in the schema — should fall back to id-only
    const result = queryBuilder.build('contact', 'findMany')
    expect(result.query).toContain('id')
    expect(result.query).not.toContain('title')
  })
})
