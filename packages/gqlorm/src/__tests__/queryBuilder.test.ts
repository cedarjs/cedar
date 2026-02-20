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

    expect(result.query).toContain('@live')
    expect(result.query).toContain('users')
    expect(result.variables).toEqual({ var0: true })
  })

  it('supports findUnique', () => {
    const result = buildQueryFromFunction(
      (db) =>
        db.user.findUnique({
          where: { id: 1 },
          select: { id: true, name: true },
        }),
      { isLive: true },
    )

    expect(result.query).toContain('user(')
    expect(result.query).toContain('@live')
    expect(result.query).toMatch(/\bname\b/)
    expect(result.query).not.toContain('createdAt')
    expect(Object.values(result.variables || {})).toEqual([1])
  })

  it('supports findMany', () => {
    const result = buildQueryFromFunction((db) =>
      db.user.findMany({
        where: { isActive: true },
        select: {
          id: true,
          email: true,
          // @ts-expect-error - Making sure types are correct
          doesNotExist: false,
        },
      }),
    )

    expect(result.query).toContain('query findManyUser')
    expect(result.query).toContain('users')
    expect(result.query).toMatch(/\bid\b/)
    expect(result.query).toMatch(/\bemail\b/)
    expect(Object.values(result.variables || {})).toEqual([true])
  })

  it('supports findFirst', () => {
    const result = buildQueryFromFunction((db) =>
      db.post.findFirst({
        where: {
          AND: [{ published: true }, { createdAt: { gt: new Date(0) } }],
        },
        select: { id: true, title: true },
      }),
    )

    expect(result.query).toContain('query findFirstPost')
    expect(result.query).toContain('post(')
    expect(result.query).toMatch(/\bid\b/)
    expect(result.query).toMatch(/\btitle\b/)
    expect(result.variables).toEqual({ var0: true, var1: new Date(0) })
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
