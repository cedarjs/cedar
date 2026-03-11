import { describe, expect, it } from 'vitest'

import { QueryParser, QueryParseError } from '../parser/queryParser.js'

describe('QueryParser', () => {
  it('parses a basic findMany query into AST', () => {
    const parser = new QueryParser()

    const ast = parser.parseQuery('user', 'findMany', {
      where: { isActive: true, name: { contains: 'Ada' } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    })

    expect(ast.type).toBe('Query')
    expect(ast.model).toBe('user')
    expect(ast.operation).toBe('findMany')
    expect(ast.args?.where?.conditions).toHaveLength(2)
    expect(ast.args?.take).toBe(5)
    expect(ast.args?.orderBy?.fields[0]).toMatchObject({
      field: 'createdAt',
      direction: 'desc',
    })
  })

  it('parses logical operators in where clauses', () => {
    const parser = new QueryParser()

    const ast = parser.parseQuery('user', 'findMany', {
      where: {
        AND: [{ isActive: true }, { age: { gte: 18 } }],
      },
    })

    const logical = ast.args?.where?.conditions[0]
    expect(logical).toMatchObject({
      type: 'LogicalCondition',
      operator: 'AND',
    })

    if (logical?.type !== 'LogicalCondition') {
      throw new Error('Expected LogicalCondition')
    }

    expect(logical.conditions).toHaveLength(2)
  })

  it('throws for invalid sort directions', () => {
    const parser = new QueryParser()

    expect(() =>
      parser.parseQuery('user', 'findMany', {
        // Casting to `any` to test thrown error
        orderBy: { createdAt: 'up' as any },
      }),
    ).toThrow(QueryParseError)
  })
})
