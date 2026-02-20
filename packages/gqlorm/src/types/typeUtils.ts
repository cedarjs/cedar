import type {
  ASTNode,
  FieldCondition,
  IncludeAST,
  LogicalCondition,
  LogicalOperator,
  QueryAST,
  RelationCondition,
  SelectAST,
  WhereAST,
  WhereCondition,
} from './ast.js'

export function isQueryAST(node: ASTNode): node is QueryAST {
  return node.type === 'Query'
}

export function isWhereAST(node: ASTNode): node is WhereAST {
  return node.type === 'Where'
}

export function isSelectAST(node: ASTNode): node is SelectAST {
  return node.type === 'Select'
}

export function isIncludeAST(node: ASTNode): node is IncludeAST {
  return node.type === 'Include'
}

export function isFieldCondition(
  condition: WhereCondition | undefined,
): condition is FieldCondition {
  return condition?.type === 'FieldCondition'
}

export function isLogicalCondition(
  condition: WhereCondition,
): condition is LogicalCondition {
  return condition.type === 'LogicalCondition'
}

export function isRelationCondition(
  condition: WhereCondition,
): condition is RelationCondition {
  return condition.type === 'RelationCondition'
}

export function isLogicalOperator(value: any): value is LogicalOperator {
  return ['AND', 'OR', 'NOT'].includes(value)
}
