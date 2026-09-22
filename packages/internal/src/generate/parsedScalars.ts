import fs from 'node:fs'

import { GraphQLFileLoader } from '@graphql-tools/graphql-file-loader'
import { loadSchemaSync } from '@graphql-tools/load'
import type { GraphQLSchema, GraphQLType } from 'graphql'
import {
  getNamedType,
  isInputObjectType,
  isListType,
  isNonNullType,
  isObjectType,
} from 'graphql'

import type { ParsedScalarsConfig } from '@cedarjs/project-config'
import { getParsedScalars, getPaths } from '@cedarjs/project-config'

/**
 * What `CedarApolloProvider` needs to make Apollo Client's cache parse the
 * scalars in `graphql.parsedScalars`. The `typePolicies` and `inputObjects`
 * are passed to `InMemoryCache` as they are.
 */
export interface ParsedScalarsCacheConfig {
  /**
   * The scalars to parse, and the type each is parsed into
   */
  scalars: ParsedScalarsConfig
  /**
   * The fields in the schema that hold a parsed scalar
   */
  typePolicies: Record<string, { fields: Record<string, { scalar: string }> }>
  /**
   * The input objects that hold a parsed scalar, directly or through another
   * input object
   */
  inputObjects: Record<string, { fields: Record<string, string> }>
}

/**
 * Apollo Client names the type of a field like GraphQL does, without
 * nullability: `DateTime`, `[DateTime]`, `[[DateTime]]`. Returns `undefined`
 * for a type that doesn't hold any of `names`.
 */
function scalarTypeName(
  type: GraphQLType,
  names: ReadonlySet<string>,
): string | undefined {
  if (isNonNullType(type)) {
    return scalarTypeName(type.ofType, names)
  }

  if (isListType(type)) {
    const inner = scalarTypeName(type.ofType, names)

    return inner === undefined ? undefined : `[${inner}]`
  }

  const name = getNamedType(type).name

  return names.has(name) ? name : undefined
}

/**
 * Finds every field in the schema that holds one of the scalars in
 * `parsedScalars`, in the shape Apollo Client's `InMemoryCache` takes, so that
 * the cache parses those fields when it reads a response and serializes them
 * in a query's variables.
 */
export function getParsedScalarsCacheConfig(
  schema: GraphQLSchema,
  parsedScalars: ParsedScalarsConfig,
): ParsedScalarsCacheConfig {
  const scalarNames = new Set(Object.keys(parsedScalars))
  const typePolicies: ParsedScalarsCacheConfig['typePolicies'] = {}
  const inputObjects: ParsedScalarsCacheConfig['inputObjects'] = {}

  if (scalarNames.size === 0) {
    return { scalars: parsedScalars, typePolicies, inputObjects }
  }

  const types = Object.values(schema.getTypeMap()).filter(
    (type) => !type.name.startsWith('__'),
  )

  for (const type of types) {
    if (!isObjectType(type)) {
      continue
    }

    for (const field of Object.values(type.getFields())) {
      const scalar = scalarTypeName(field.type, scalarNames)

      if (scalar) {
        typePolicies[type.name] ??= { fields: {} }
        typePolicies[type.name].fields[field.name] = { scalar }
      }
    }
  }

  // An input object needs an entry when it holds a scalar, or holds another
  // input object that needs one. Adding an input object can make another one
  // qualify, so keep going until nothing more is added
  const inputTypes = types.filter(isInputObjectType)
  let inputObjectNames = new Set<string>()
  let grew = true

  while (grew) {
    const names = new Set([...scalarNames, ...inputObjectNames])
    const next = new Set(inputObjectNames)

    for (const type of inputTypes) {
      const holdsScalar = Object.values(type.getFields()).some(
        (field) => scalarTypeName(field.type, names) !== undefined,
      )

      if (holdsScalar) {
        next.add(type.name)
      }
    }

    grew = next.size > inputObjectNames.size
    inputObjectNames = next
  }

  const names = new Set([...scalarNames, ...inputObjectNames])

  for (const type of inputTypes) {
    if (!inputObjectNames.has(type.name)) {
      continue
    }

    const fields: Record<string, string> = {}

    for (const field of Object.values(type.getFields())) {
      const fieldType = scalarTypeName(field.type, names)

      if (fieldType) {
        fields[field.name] = fieldType
      }
    }

    inputObjects[type.name] = { fields }
  }

  return { scalars: parsedScalars, typePolicies, inputObjects }
}

/**
 * Reads the project's `graphql.parsedScalars` setting and its generated
 * GraphQL schema, and returns the cache config for them. Returns `undefined`
 * when no scalar is set to be parsed, or when the schema hasn't been generated.
 */
export function loadParsedScalarsCacheConfig():
  ParsedScalarsCacheConfig | undefined {
  const parsedScalars = getParsedScalars()

  if (Object.keys(parsedScalars).length === 0) {
    return undefined
  }

  const schemaPath = getPaths().generated.schema

  // The dev server can start before the schema has been generated for the
  // first time. `loadSchemaSync` throws when the file doesn't exist, so this
  // returns `undefined`, same as when no scalar is parsed, rather than
  // failing the whole app. A later schema generation reloads the app, so a
  // schema that appears afterward still takes effect
  if (!fs.existsSync(schemaPath)) {
    return undefined
  }

  const schema = loadSchemaSync(schemaPath, {
    loaders: [new GraphQLFileLoader()],
    sort: true,
  })

  return getParsedScalarsCacheConfig(schema, parsedScalars)
}
