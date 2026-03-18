/**
 * GraphQL query generator that converts AST to GraphQL query strings
 * Transforms our internal AST representation into valid GraphQL queries
 */

import type {
  ComparisonOperator,
  FieldCondition,
  IncludeAST,
  LogicalCondition,
  OrderByAST,
  QueryArgsAST,
  QueryAST,
  RelationCondition,
  SelectAST,
  WhereAST,
  WhereCondition,
} from '../types/ast.js'
import { type ModelSchema } from '../types/schema.js'
import {
  isFieldCondition,
  isLogicalCondition,
  isRelationCondition,
} from '../types/typeUtils.js'

export class GraphQLGenerateError extends Error {
  constructor(
    message: string,
    public context?: any,
  ) {
    super(message)
    this.name = 'GraphQLGenerateError'
  }
}

export interface GraphQLQuery {
  query: string
  variables?: Record<string, any>
}

export class GraphQLGenerator {
  #variableCounter = 0
  #variables: Record<string, any> = {}
  // Track field names for each variable
  #variableFields = new Map<string, string>()
  // Track current operation for context-aware type generation
  #operation?: string | undefined
  #schema: ModelSchema | undefined

  constructor(schema?: ModelSchema) {
    this.#schema = schema
  }

  /**
   * Generate GraphQL query from AST
   */
  generate(ast: QueryAST): GraphQLQuery {
    this.#resetState()
    this.#operation = ast.operation

    const operationName = this.#generateOperationName(ast)
    const queryBody = this.#generateQueryBody(ast)

    let query = `query ${operationName}`

    // Add variables if any were used
    const hasVariables = Object.keys(this.#variables).length > 0
    if (hasVariables) {
      const variableDefinitions = this.#generateVariableDefinitions()
      query += `(${variableDefinitions})`
    }

    query += ` {\n${queryBody}\n}`

    const result: GraphQLQuery = { query }
    if (hasVariables) {
      result.variables = structuredClone(this.#variables)
    }
    return result
  }

  /**
   * Reset internal state for new query generation
   */
  #resetState(): void {
    this.#variableCounter = 0
    this.#variables = {}
    this.#variableFields.clear()
    this.#operation = undefined
  }

  /**
   * Generate operation name
   */
  #generateOperationName(ast: QueryAST): string {
    const { model, operation } = ast
    return `${operation}${this.#capitalize(model)}`
  }

  /**
   * Generate main query body
   */
  #generateQueryBody(ast: QueryAST): string {
    const { model, operation, args, isLive } = ast

    const fieldName = this.#getGraphQLFieldName(model, operation)

    let query = `  ${fieldName}`

    if (args) {
      const argsString = this.#generateArguments(args, operation)
      if (argsString) {
        query += `(${argsString})`
      }
    }

    if (isLive) {
      query += ' @live'
    }

    const fields = this.#generateFieldSelection(args, model)
    query += ` {\n${fields}\n  }`

    return query
  }

  /**
   * Convert operation to GraphQL field name
   */
  #getGraphQLFieldName(model: string, operation: string): string {
    switch (operation) {
      case 'findMany':
        // TODO: Use Cedar's pluralization function
        // Simple pluralization
        return `${model}s`
      case 'findUnique':
      case 'findUniqueOrThrow':
        return model
      case 'findFirst':
      case 'findFirstOrThrow':
        return model
      default:
        throw new GraphQLGenerateError(`Unsupported operation: ${operation}`)
    }
  }

  /**
   * Generate GraphQL arguments from query args
   */
  #generateArguments(args?: QueryArgsAST, operation?: string): string {
    const argParts: string[] = []

    if (args?.where) {
      // Special handling for findUnique operations with simple where clauses
      const isFindUnique =
        operation === 'findUnique' || operation === 'findUniqueOrThrow'
      const simpleUniqueArg = isFindUnique
        ? this.#extractSimpleUniqueArgument(args.where)
        : null

      if (simpleUniqueArg) {
        // Use direct argument format for simple unique queries: user(id: $var0)
        argParts.push(simpleUniqueArg)
      } else {
        // Use where wrapper for complex conditions
        const whereArg = this.#generateWhereArgument(args.where)
        if (whereArg && whereArg !== '{}') {
          argParts.push(`where: ${whereArg}`)
        }
      }
    }

    if (args?.orderBy) {
      const orderByArg = this.#generateOrderByArgument(args.orderBy)
      argParts.push(`orderBy: ${orderByArg}`)
    }

    if (typeof args?.take === 'number') {
      argParts.push(`first: ${args.take}`)
    }

    if (typeof args?.skip === 'number') {
      argParts.push(`skip: ${args.skip}`)
    }

    return argParts.join(', ')
  }

  /**
   * Extract simple unique argument for findUnique operations
   * Returns direct argument format (e.g., "id: $var0") if the where clause
   * contains a single simple field equality, otherwise returns null
   */
  #extractSimpleUniqueArgument(where: WhereAST): string | null {
    // Only process if there's exactly one condition
    if (where.conditions.length !== 1) {
      return null
    }

    const condition = where.conditions[0]

    // Only process simple field conditions with equals operator
    if (!isFieldCondition(condition) || condition.operator !== 'equals') {
      return null
    }

    // Generate the direct argument
    const variableName = this.#addVariable(condition.value, condition.field)
    return `${condition.field}: $${variableName}`
  }

  /**
   * Generate variable definitions for GraphQL query
   */
  #generateVariableDefinitions(): string {
    return Object.entries(this.#variables)
      .map(([name, value]) => {
        const fieldName = this.#variableFields.get(name)
        const baseType = this.#getGraphQLType(value, fieldName)

        const isFindUnique =
          this.#operation === 'findUnique' ||
          this.#operation === 'findUniqueOrThrow'
        const isIdField = fieldName === 'id' || fieldName?.endsWith('Id')

        // Add non-null modifier for ID fields in findUnique operations
        if (isFindUnique && isIdField && !baseType.includes('!')) {
          return `$${name}: ${baseType}!`
        }

        return `$${name}: ${baseType}`
      })
      .join(', ')
  }

  /**
   * Generate WHERE argument
   */
  #generateWhereArgument(where: WhereAST): string {
    const conditions = where.conditions.map((condition) =>
      this.#generateCondition(condition),
    )

    if (conditions.length === 0) {
      return '{}'
    }

    if (conditions.length === 1) {
      return conditions[0]
    }

    // Multiple conditions - wrap in AND
    return `{ AND: [${conditions.join(', ')}] }`
  }

  /**
   * Generate individual where condition
   */
  #generateCondition(condition: WhereCondition): string {
    if (isFieldCondition(condition)) {
      return this.#generateFieldCondition(condition)
    } else if (isLogicalCondition(condition)) {
      return this.#generateLogicalCondition(condition)
    } else if (isRelationCondition(condition)) {
      return this.#generateRelationCondition(condition)
    }

    throw new GraphQLGenerateError('Unknown condition type', { condition })
  }

  /**
   * Generate field condition
   */
  #generateFieldCondition(condition: FieldCondition): string {
    const { field, operator, value } = condition

    if (operator === 'equals') {
      const variableName = this.#addVariable(value, field)
      return `{ ${field}: $${variableName} }`
    }

    const operatorMap: Record<ComparisonOperator, string> = {
      equals: 'equals',
      not: 'not',
      in: 'in',
      notIn: 'notIn',
      lt: 'lt',
      lte: 'lte',
      gt: 'gt',
      gte: 'gte',
      contains: 'contains',
      startsWith: 'startsWith',
      endsWith: 'endsWith',
      isNull: 'isNull',
      isNotNull: 'isNotNull',
    }

    const gqlOperator = operatorMap[operator]
    if (!gqlOperator) {
      throw new GraphQLGenerateError(`Unsupported operator: ${operator}`)
    }

    if (operator === 'isNull' || operator === 'isNotNull') {
      return `{ ${field}: { ${gqlOperator}: ${operator === 'isNull'} } }`
    }

    const variableName = this.#addVariable(value, field)
    return `{ ${field}: { ${gqlOperator}: $${variableName} } }`
  }

  /**
   * Generate logical condition
   */
  #generateLogicalCondition(condition: LogicalCondition): string {
    const { operator, conditions } = condition

    const conditionStrings = conditions.map((cond) =>
      this.#generateCondition(cond),
    )

    if (operator === 'NOT') {
      if (conditionStrings.length !== 1) {
        throw new GraphQLGenerateError(
          'NOT operator must have exactly one condition',
        )
      }
      return `{ NOT: ${conditionStrings[0]} }`
    }

    return `{ ${operator}: [${conditionStrings.join(', ')}] }`
  }

  /**
   * Generate relation condition
   */
  #generateRelationCondition(condition: RelationCondition): string {
    const { relation, condition: nestedCondition } = condition
    const whereArg = this.#generateWhereArgument(nestedCondition)
    return `{ ${relation}: ${whereArg} }`
  }

  /**
   * Generate ORDER BY argument
   */
  #generateOrderByArgument(orderBy: OrderByAST): string {
    const fields = orderBy.fields.map((field) => {
      const direction = field.direction.toUpperCase()
      return `{ ${field.field}: ${direction} }`
    })

    if (fields.length === 1) {
      return fields[0]
    }

    return `[${fields.join(', ')}]`
  }

  /**
   * Generate field selection
   */
  #generateFieldSelection(args?: QueryArgsAST, model?: string): string {
    // If we have explicit select, use that
    if (args?.select) {
      return this.#generateSelectFields(args.select)
    }

    // If we have include, generate based on that
    if (args?.include) {
      return this.#generateIncludeFields(args.include)
    }

    // Use schema if available
    if (model && this.#schema && this.#schema[model]) {
      const fields = this.#schema[model]
      return fields.map((field) => `    ${field}`).join('\n')
    }

    // Default selection - return all scalar fields
    return '    id\n    createdAt\n    updatedAt'
  }

  /**
   * Generate fields from SELECT clause
   */
  #generateSelectFields(select: SelectAST): string {
    const fieldStrings: string[] = []

    for (const fieldSelection of select.fields) {
      if (!fieldSelection.selected) {
        continue // Skip excluded fields
      }

      if (fieldSelection.nested) {
        // Nested selection
        const nestedFields =
          fieldSelection.nested.type === 'Select'
            ? this.#generateSelectFields(fieldSelection.nested)
            : this.#generateIncludeFields(fieldSelection.nested)

        const indentedFields = this.#indent(nestedFields, 2)
        fieldStrings.push(
          `    ${fieldSelection.field} {\n${indentedFields}\n    }`,
        )
      } else {
        fieldStrings.push(`    ${fieldSelection.field}`)
      }
    }

    return fieldStrings.join('\n')
  }

  /**
   * Generate fields from INCLUDE clause
   */
  #generateIncludeFields(include: IncludeAST): string {
    const fieldStrings: string[] = []

    // Add default scalar fields
    fieldStrings.push('    id')

    for (const relationInclusion of include.relations) {
      if (!relationInclusion.included) {
        continue
      }

      let relationQuery = `    ${relationInclusion.relation}`

      // Add arguments if present
      if (relationInclusion.args) {
        const argsString = this.#generateArguments(relationInclusion.args)
        if (argsString) {
          relationQuery += `(${argsString})`
        }
      }

      // Add nested fields
      let nestedFields: string
      if (relationInclusion.nested) {
        nestedFields = this.#generateIncludeFields(relationInclusion.nested)
      } else if (relationInclusion.args?.select) {
        nestedFields = this.#generateSelectFields(relationInclusion.args.select)
      } else {
        // Default
        nestedFields = '      id'
      }

      relationQuery += ` {\n${this.#indent(nestedFields, 2)}\n    }`
      fieldStrings.push(relationQuery)
    }

    return fieldStrings.join('\n')
  }

  /**
   * Add variable and return variable name
   */
  #addVariable(value: any, fieldName?: string): string {
    const variableName = `var${this.#variableCounter++}`
    this.#variables[variableName] = value
    if (fieldName) {
      this.#variableFields.set(variableName, fieldName)
    }
    return variableName
  }

  /**
   * Get GraphQL type for a value
   */
  #getGraphQLType(value: any, fieldName?: string): string {
    // Check if this is an ID field (common identifier field names)
    const isIdField = fieldName && /^(id|.*Id|.*ID)$/.test(fieldName)

    // Handle undefined/null values - use ID type for ID fields
    if (value === undefined || value === null) {
      return isIdField ? 'ID' : 'String'
    }

    if (typeof value === 'string') {
      return isIdField ? 'ID' : 'String'
    }
    if (typeof value === 'number') {
      if (isIdField) {
        return 'ID'
      }
      return Number.isInteger(value) ? 'Int' : 'Float'
    }
    if (typeof value === 'boolean') {
      return 'Boolean'
    }
    if (value instanceof Date) {
      return 'DateTime'
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        return '[String]' // Default to string array
      }
      const itemType = this.#getGraphQLType(value[0], fieldName)
      // Add non-null modifier for ID array items
      if (isIdField && (itemType === 'ID' || itemType === 'String')) {
        return `[ID!]`
      }
      return `[${itemType}]`
    }

    return 'String' // Default fallback
  }

  /**
   * Capitalize first letter of string
   */
  #capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1)
  }

  /**
   * Indent text by specified number of levels
   */
  #indent(text: string, levels: number): string {
    const indentation = '  '.repeat(levels)
    return text
      .split('\n')
      .map((line) => (line.trim() ? `${indentation}${line}` : line))
      .join('\n')
  }
}

// Export singleton instance
export const graphqlGenerator = new GraphQLGenerator()
