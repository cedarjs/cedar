import { describe, expect, it } from 'vitest'

import {
  buildQuery,
  buildQueryFromFunction,
  QueryBuilder,
} from '../queryBuilder.js'

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

  it('builds query from function capture', () => {
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
