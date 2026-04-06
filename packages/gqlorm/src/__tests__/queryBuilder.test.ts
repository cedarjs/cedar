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

declare module '../types/orm.js' {
  interface GqlormTypeMap {
    db: {
      user: OrmTypes.ModelDelegate<CedarUser>
      post: OrmTypes.ModelDelegate<CedarPost>
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
          createdAt
          updatedAt
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
            AND: [{ published: true }, { createdAt: { gt: new Date(0) } }],
          },
          select: { id: true, title: true },
        }),
      { isLive: true },
    )

    expect(result.variables).toEqual({ var0: true, var1: new Date(0) })
    expect(result.query).toMatchInlineSnapshot(`
      "query findFirstPost($var0: Boolean, $var1: DateTime) @live {
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
})
