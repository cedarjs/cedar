import fs from 'node:fs'

import type { types } from '@babel/core'
import { parse } from '@babel/parser'
import fg from 'fast-glob'

import { getPaths } from '@cedarjs/project-config'

/**
 * Field names, per GraphQL type, that services provide field resolvers for.
 *
 * Services provide field resolvers for a type by exporting an object named
 * after the type, e.g. `export const Post = { author: (_args, { root }) => … }`.
 * GraphQL server merges these exports from all services, so the field names
 * here are merged the same way.
 */
export type ServiceFieldResolvers = Record<string, string[]>

const ROOT_TYPES = ['Query', 'Mutation', 'Subscription']

/**
 * Whether GraphQL server loads this file as a service. This matches the
 * filters of the `src/services/**\/*.{js,ts}` glob import, in both
 * vite-plugin-cedar-import-dir and babel-plugin-redwood-import-dir, so field
 * resolvers in files that aren't loaded don't affect the generated types.
 */
export const isLoadedServiceFile = (filePath: string) => {
  return (
    /\.(js|ts)$/.test(filePath) &&
    !filePath.includes('.test.') &&
    !filePath.includes('.scenarios.') &&
    !filePath.includes('.d.ts')
  )
}

const findServiceFiles = (cwd: string = getPaths().api.services) => {
  return fg
    .sync('**/*.{js,ts}', { cwd, absolute: true })
    .filter(isLoadedServiceFile)
}

// Strips wrappers like `{ … } satisfies PostRelationResolvers` and
// `{ … } as PostRelationResolvers` to get at the object literal
const unwrapExpression = (node: types.Node): types.Node => {
  if (
    node.type === 'TSSatisfiesExpression' ||
    node.type === 'TSAsExpression' ||
    node.type === 'TSNonNullExpression' ||
    node.type === 'ParenthesizedExpression'
  ) {
    return unwrapExpression(node.expression)
  }

  return node
}

const getPropertyName = (
  property: types.ObjectExpression['properties'][number],
) => {
  if (property.type === 'SpreadElement' || property.computed) {
    return undefined
  }

  if (property.key.type === 'Identifier') {
    return property.key.name
  }

  if (property.key.type === 'StringLiteral') {
    return property.key.value
  }

  return undefined
}

/**
 * Finds the field resolvers in a single service file.
 *
 * Only object literals exported directly (`export const Post = { … }`) are
 * recognized. Keys that can't be determined statically, like spread or
 * computed keys, are skipped. A skipped field stays required on resolver
 * results, which is the safe side to err on.
 */
export const getFieldResolversFromAst = (
  ast: types.File,
): ServiceFieldResolvers => {
  const fieldResolvers: ServiceFieldResolvers = {}

  for (const statement of ast.program.body) {
    if (
      statement.type !== 'ExportNamedDeclaration' ||
      statement.declaration?.type !== 'VariableDeclaration'
    ) {
      continue
    }

    for (const declarator of statement.declaration.declarations) {
      if (declarator.id.type !== 'Identifier' || !declarator.init) {
        continue
      }

      const typeName = declarator.id.name

      if (ROOT_TYPES.includes(typeName)) {
        continue
      }

      const init = unwrapExpression(declarator.init)

      if (init.type !== 'ObjectExpression') {
        continue
      }

      const fieldNames = init.properties
        .map(getPropertyName)
        .filter((name): name is string => name !== undefined)

      fieldResolvers[typeName] = [
        ...(fieldResolvers[typeName] ?? []),
        ...fieldNames,
      ]
    }
  }

  return fieldResolvers
}

/**
 * Finds the field resolvers that all the project's services provide, keyed by
 * GraphQL type name. Field names are sorted and de-duplicated so the result
 * is stable across runs.
 */
export const getServiceFieldResolvers = (
  serviceFiles: string[] = findServiceFiles(),
): ServiceFieldResolvers => {
  const merged: Record<string, Set<string>> = {}

  for (const file of serviceFiles) {
    let ast: types.File

    try {
      ast = parse(fs.readFileSync(file, 'utf-8'), {
        sourceType: 'module',
        plugins: ['typescript'],
      })
    } catch {
      // A service that doesn't parse can't be used at runtime either, and the
      // build reports the syntax error. Its fields stay required until it's
      // fixed
      continue
    }

    const fieldResolvers = getFieldResolversFromAst(ast)

    for (const [typeName, fieldNames] of Object.entries(fieldResolvers)) {
      merged[typeName] ??= new Set()

      for (const fieldName of fieldNames) {
        merged[typeName].add(fieldName)
      }
    }
  }

  return Object.fromEntries(
    Object.keys(merged)
      .sort()
      .map((typeName) => [typeName, [...merged[typeName]].sort()]),
  )
}
