import { describe, expect, it } from 'vitest'

import {
  buildQuery,
  buildQueryFromFunction,
  QueryBuilder,
} from '../queryBuilder.js'
import type * as OrmTypes from '../types/orm.js'

interface CedarUser {
  id: number
  createdAt: Date
  updatedAt: Date
  email: string
  name: string
  isActive: boolean
}

interface CedarPost {
  id: number
  createdAt: Date
  updatedAt: Date
  title: string
  published: boolean
}

interface GqlormScalarUser {
  id: number
  email: string
  name: string
  isActive: boolean
}

interface GqlormScalarPost {
  id: number
  title: string
  published: boolean
  createdAt: string
}

declare module '../types/orm.js' {
  interface GqlormTypeMap {
    db: {
      user: OrmTypes.ModelDelegate<CedarUser>
      post: OrmTypes.ModelDelegate<CedarPost>
    }
    models: {
      user: GqlormScalarUser
      post: GqlormScalarPost
    }
  }
}

describe('QueryBuilder', () => {
  it('builds a live query when requested', () => {
    const result = buildQuery(
      'user',
      'findMany',
      { where: { isActive: true } },
      { isLive: true },
    )

    expect(result.variables).toEqual({ var0: true })
    expect(result.query).toMatchInlineSnapshot(`
      "query findManyUser($var0: Boolean) @live {
        users(where: { isActive: $var0 }) {
          id
        }
      }"
    `)
  })

  it('supports findUnique', () => {
    const result = buildQueryFromFunction(
      (gqlorm) =>
        gqlorm.user.findUnique({
          where: { id: 1 },
          select: { id: true, name: true },
        }),
      { isLive: true },
    )

    expect(result.query).toMatchInlineSnapshot(`
      "query findUniqueUser($var0: ID!) @live {
        user(id: $var0) {
          id
          name
        }
      }"
    `)
  })

  it('supports findMany', () => {
    const result = buildQueryFromFunction((gqlorm) =>
      gqlorm.user.findMany({
        where: { isActive: true },
        select: {
          id: true,
          email: true,
          // @ts-expect-error - Making sure types are correct
          doesNotExist: false,
        },
      }),
    )

    expect(result.variables).toEqual({ var0: true })
    expect(result.query).toMatchInlineSnapshot(`
      "query findManyUser($var0: Boolean) {
        users(where: { isActive: $var0 }) {
          id
          email
        }
      }"
    `)
  })

  it('supports findFirst', () => {
    const result = buildQueryFromFunction(
      (gqlorm) =>
        gqlorm.post.findFirst({
          where: {
            AND: [
              { published: true },
              { createdAt: { gt: '1970-01-01T00:00:00.000Z' } },
            ],
          },
          select: { id: true, title: true },
        }),
      { isLive: true },
    )

    expect(result.variables).toEqual({
      var0: true,
      var1: '1970-01-01T00:00:00.000Z',
    })
    expect(result.query).toMatchInlineSnapshot(`
      "query findFirstPost($var0: Boolean, $var1: String) @live {
        post(where: { AND: [{ published: $var0 }, { createdAt: { gt: $var1 } }] }) {
          id
          title
        }
      }"
    `)
  })

  it('respects forceLiveQueries but allows explicit override', () => {
    const qb = new QueryBuilder({ forceLiveQueries: true })

    const forcedLive = qb.build('user', 'findMany')
    expect(forcedLive.query).toContain('@live')

    const explicitNonLive = qb.build('user', 'findMany', undefined, {
      isLive: false,
    })
    expect(explicitNonLive.query).not.toContain('@live')
  })

  it('maps model delegates to generated scalar model types', () => {
    type UserDelegate = OrmTypes.FrameworkDbClient['user']
    type PostDelegate = OrmTypes.FrameworkDbClient['post']

    type UserResult = Awaited<ReturnType<UserDelegate['findMany']>>
    type PostResult = Awaited<ReturnType<PostDelegate['findUniqueOrThrow']>>

    const userRows: UserResult = [
      {
        id: 1,
        email: 'user@example.com',
        name: 'User',
        isActive: true,
      },
    ]
    const postRow: PostResult = {
      id: 1,
      title: 'Hello',
      published: true,
      createdAt: '2024-01-01T00:00:00.000Z',
    }

    expect(userRows[0]?.email).toBe('user@example.com')
    expect(postRow.title).toBe('Hello')
  })

  it('keeps query function inference aligned with generated scalar model types', () => {
    type QueryResult = Awaited<
      ReturnType<
        (db: OrmTypes.FrameworkDbClient) => ReturnType<typeof db.post.findMany>
      >
    >

    const rows: QueryResult = [
      {
        id: 1,
        title: 'Hello',
        published: true,
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ]

    expect(rows[0]?.published).toBe(true)
  })
})
