/**
 * Query parser that converts ORM-style queries to AST representation
 * Handles parsing of Prisma-like query syntax into our internal AST format
 */

import type {
  ComparisonOperator,
  FieldCondition,
  FieldSelection,
  IncludeAST,
  LogicalCondition,
  LogicalOperator,
  OrderByAST,
  OrderByField,
  QueryArgsAST,
  QueryAST,
  QueryOperation,
  RelationCondition,
  RelationInclusion,
  SelectAST,
  WhereAST,
  WhereCondition,
} from '../types/ast.js'
import type {
  FindFirstArgs,
  FindManyArgs,
  FindUniqueArgs,
  IncludeInput,
  OrderByInput,
  SelectInput,
  WhereInput,
} from '../types/orm.js'
import { isLogicalOperator } from '../types/typeUtils.js'

export class QueryParseError extends Error {
  constructor(
    message: string,
    public context?: any,
  ) {
    super(message)
    this.name = 'QueryParseError'
  }
}

export class QueryParser {
  /**
   * Parse a complete query from model, operation, and arguments
   */
  parseQuery(
    model: string,
    operation: QueryOperation,
    args?: FindManyArgs<any> | FindUniqueArgs<any> | FindFirstArgs<any>,
  ): QueryAST {
    if (!model || !operation) {
      throw new QueryParseError('Model and operation are required')
    }

    const query: QueryAST = {
      type: 'Query',
      model,
      operation,
    } satisfies QueryAST

    if (args && Object.keys(args).length > 0) {
      query.args = this.#parseQueryArgs(args)
    }

    return query
  }

  /**
   * Parse query arguments into AST
   */
  #parseQueryArgs(args: any): QueryArgsAST {
    const queryArgs: QueryArgsAST = {
      type: 'QueryArgs',
    } satisfies QueryArgsAST

    if (args.where) {
      queryArgs.where = this.#parseWhere(args.where)
    }

    if (args.select) {
      queryArgs.select = this.#parseSelect(args.select)
    }

    if (args.include) {
      queryArgs.include = this.#parseInclude(args.include)
    }

    if (args.orderBy) {
      queryArgs.orderBy = this.#parseOrderBy(args.orderBy)
    }

    if (typeof args.take === 'number') {
      queryArgs.take = args.take
    }

    if (typeof args.skip === 'number') {
      queryArgs.skip = args.skip
    }

    return queryArgs
  }

  /**
   * Parse WHERE clause into AST
   */
  #parseWhere(where: WhereInput<any>): WhereAST {
    const conditions = this.#parseWhereConditions(where)

    return {
      type: 'Where',
      conditions,
    }
  }

  /**
   * Parse where conditions recursively
   */
  // TODO: See if we can type `where` to `Record<any, any>`
  #parseWhereConditions(where: any): WhereCondition[] {
    const conditions = Object.entries(where).map(([key, value]) => {
      if (isLogicalOperator(key)) {
        return this.#parseLogicalCondition(key, value)
      }

      if (this.#isRelationCondition(value)) {
        return this.#parseRelationCondition(key, value)
      }

      return this.#parseFieldCondition(key, value)
    })

    return conditions
  }

  /**
   * Parse logical condition (AND, OR, NOT)
   */
  #parseLogicalCondition(
    operator: LogicalOperator,
    value: any,
  ): LogicalCondition {
    let nestedConditions: WhereCondition[] = []

    if (operator === 'NOT') {
      // NOT expects a single condition object
      nestedConditions = this.#parseWhereConditions(value)
    } else {
      // AND/OR expect arrays of condition objects
      if (Array.isArray(value)) {
        for (const condition of value) {
          nestedConditions.push(...this.#parseWhereConditions(condition))
        }
      } else {
        throw new QueryParseError(`${operator} operator expects an array`, {
          operator,
          value,
        })
      }
    }

    return {
      type: 'LogicalCondition',
      operator,
      conditions: nestedConditions,
    }
  }

  /**
   * Check if a value represents a relation condition
   */
  #isRelationCondition(value: any): boolean {
    // Simple heuristic: if it's an object with nested conditions, treat as relation
    // TODO: In a full implementation, this would use schema information
    return (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      !this.#isFilterObject(value) &&
      !(value instanceof Date)
    )
  }

  /**
   * Parse relation condition
   */
  #parseRelationCondition(field: string, value: any): RelationCondition {
    // This would need more sophisticated logic in a real implementation
    // For now, we'll create a basic relation condition
    const nestedConditions = this.#parseWhereConditions(value)

    return {
      type: 'RelationCondition',
      relation: field,
      condition: {
        type: 'Where',
        conditions: nestedConditions,
      },
    }
  }

  /**
   * Check if value represents a filter object
   */
  #isFilterObject(value: any): boolean {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return false
    }

    const filterOperators = new Set([
      'equals',
      'not',
      'in',
      'notIn',
      'lt',
      'lte',
      'gt',
      'gte',
      'contains',
      'startsWith',
      'endsWith',
      'isNull',
      'isNotNull',
    ])

    return Object.keys(value).some((key) => filterOperators.has(key))
  }

  /**
   * Parse field condition
   */
  #parseFieldCondition(field: string, value: any): FieldCondition {
    // Simple equality check
    if (!this.#isFilterObject(value)) {
      return {
        type: 'FieldCondition',
        field,
        operator: 'equals',
        value,
      }
    }

    // Parse filter object
    const filterEntries = Object.entries(value)
    if (filterEntries.length !== 1) {
      throw new QueryParseError(
        `Field condition must have exactly one operator`,
        { field, value },
      )
    }

    const [operatorStr, operatorValue] = filterEntries[0]
    const operator = this.parseComparisonOperator(operatorStr)

    return {
      type: 'FieldCondition',
      field,
      operator,
      value: operatorValue,
    }
  }

  /**
   * Parse comparison operator string
   */
  private parseComparisonOperator(operator: string): ComparisonOperator {
    const validOperators: ComparisonOperator[] = [
      'equals',
      'not',
      'in',
      'notIn',
      'lt',
      'lte',
      'gt',
      'gte',
      'contains',
      'startsWith',
      'endsWith',
      'isNull',
      'isNotNull',
    ]

    if (!validOperators.includes(operator as ComparisonOperator)) {
      throw new QueryParseError(`Invalid comparison operator: ${operator}`)
    }

    return operator as ComparisonOperator
  }

  /**
   * Parse SELECT clause into AST
   */
  #parseSelect(select: SelectInput<any>): SelectAST {
    const fields: FieldSelection[] = []

    for (const [field, selected] of Object.entries(select)) {
      if (typeof selected === 'boolean') {
        fields.push({
          type: 'FieldSelection',
          field,
          selected,
        })
      } else if (typeof selected === 'object' && selected !== null) {
        // Nested selection
        const selectedObj = selected as any

        const fieldSelection: FieldSelection = {
          type: 'FieldSelection',
          field,
          selected: true,
        }

        if (selectedObj.select) {
          fieldSelection.nested = this.#parseSelect(selectedObj.select)
        } else if (selectedObj.include) {
          fieldSelection.nested = this.#parseInclude(selectedObj.include)
        }

        fields.push(fieldSelection)
      }
    }

    return {
      type: 'Select',
      fields,
    }
  }

  /**
   * Parse INCLUDE clause into AST
   */
  #parseInclude(include: IncludeInput<any>): IncludeAST {
    const relations: RelationInclusion[] = []

    for (const [relation, inclusion] of Object.entries(include)) {
      if (typeof inclusion === 'boolean') {
        relations.push({
          type: 'RelationInclusion',
          relation,
          included: inclusion,
        })
      } else if (typeof inclusion === 'object' && inclusion !== null) {
        const relationInclusion: RelationInclusion = {
          type: 'RelationInclusion',
          relation,
          included: true,
        }

        // Parse nested includes
        if (inclusion.include) {
          relationInclusion.nested = this.#parseInclude(inclusion.include)
        }

        // Parse nested query arguments
        if (
          inclusion.select ||
          inclusion.where ||
          inclusion.orderBy ||
          inclusion.take ||
          inclusion.skip
        ) {
          relationInclusion.args = this.#parseQueryArgs(inclusion)
        }

        relations.push(relationInclusion)
      }
    }

    return {
      type: 'Include',
      relations,
    }
  }

  /**
   * Parse ORDER BY clause
   */
  #parseOrderBy(orderBy: OrderByInput<any> | OrderByInput<any>[]): OrderByAST {
    const fields: OrderByField[] = []

    const orderByArray = Array.isArray(orderBy) ? orderBy : [orderBy]

    for (const orderByItem of orderByArray) {
      for (const [field, direction] of Object.entries(orderByItem)) {
        if (direction === 'asc' || direction === 'desc') {
          fields.push({
            type: 'OrderByField',
            field,
            direction,
          })
        } else {
          throw new QueryParseError(
            `Invalid sort direction: ${direction}. Must be 'asc' or 'desc'`,
          )
        }
      }
    }

    return {
      type: 'OrderBy',
      fields,
    }
  }

  /**
   * Validate AST structure
   */
  validateAST(ast: QueryAST): void {
    // Basic validation - in a full implementation this would be more comprehensive
    if (!ast.model || !ast.operation) {
      throw new QueryParseError('Invalid AST: missing model or operation')
    }

    if (
      ast.operation === 'findUnique' ||
      ast.operation === 'findUniqueOrThrow'
    ) {
      if (!ast.args?.where) {
        throw new QueryParseError(
          'findUnique operations require a where clause',
        )
      }
    }

    // Additional validations can be added here
  }
}

// Export singleton instance
export const queryParser = new QueryParser()
