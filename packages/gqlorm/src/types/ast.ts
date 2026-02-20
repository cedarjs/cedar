/**
 * Abstract Syntax Tree (AST) types for representing parsed ORM queries
 * These types form the intermediate representation between ORM syntax and
 * GraphQL queries
 */

export interface ASTNode {
  type: string
}

export type QueryOperation =
  | 'findMany'
  | 'findUnique'
  | 'findFirst'
  | 'findUniqueOrThrow'
  | 'findFirstOrThrow'

// Root query AST node
export interface QueryAST extends ASTNode {
  type: 'Query'
  model: string
  operation: QueryOperation
  args?: QueryArgsAST
  // Indicates if this query should use @live directive
  isLive?: boolean
}

// Query arguments container
export interface QueryArgsAST extends ASTNode {
  type: 'QueryArgs'
  where?: WhereAST
  select?: SelectAST
  include?: IncludeAST
  orderBy?: OrderByAST
  take?: number
  skip?: number
}

// WHERE clause AST
export interface WhereAST extends ASTNode {
  type: 'Where'
  conditions: WhereCondition[]
}

export type WhereCondition =
  | FieldCondition
  | LogicalCondition
  | RelationCondition

export interface FieldCondition extends ASTNode {
  type: 'FieldCondition'
  field: string
  operator: ComparisonOperator
  value: any
}

export interface LogicalCondition extends ASTNode {
  type: 'LogicalCondition'
  operator: LogicalOperator
  conditions: WhereCondition[]
}

export interface RelationCondition extends ASTNode {
  type: 'RelationCondition'
  relation: string
  condition: WhereAST
}

// Comparison operators for WHERE conditions
export type ComparisonOperator =
  | 'equals'
  | 'not'
  | 'in'
  | 'notIn'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'contains'
  | 'startsWith'
  | 'endsWith'
  | 'isNull'
  | 'isNotNull'

// Logical operators
export type LogicalOperator = 'AND' | 'OR' | 'NOT'

// SELECT clause AST
export interface SelectAST extends ASTNode {
  type: 'Select'
  fields: FieldSelection[]
}

export interface FieldSelection extends ASTNode {
  type: 'FieldSelection'
  field: string
  selected: boolean
  nested?: SelectAST | IncludeAST
}

// INCLUDE clause AST (for relations)
export interface IncludeAST extends ASTNode {
  type: 'Include'
  relations: RelationInclusion[]
}

export interface RelationInclusion extends ASTNode {
  type: 'RelationInclusion'
  relation: string
  included: boolean
  nested?: IncludeAST
  args?: QueryArgsAST
}

// ORDER BY clause AST
export interface OrderByAST extends ASTNode {
  type: 'OrderBy'
  fields: OrderByField[]
}

export interface OrderByField extends ASTNode {
  type: 'OrderByField'
  field: string
  direction: 'asc' | 'desc'
}

// Utility types for working with AST
export type ASTNodeType =
  | QueryAST
  | QueryArgsAST
  | WhereAST
  | SelectAST
  | IncludeAST
  | OrderByAST
  | FieldCondition
  | LogicalCondition
  | RelationCondition
  | FieldSelection
  | RelationInclusion
  | OrderByField
