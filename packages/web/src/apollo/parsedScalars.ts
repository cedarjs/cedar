import { Scalar } from '@apollo/client'
import type { InMemoryCacheConfig, TypePolicies } from '@apollo/client'

/**
 * The cache config that `vite-plugin-cedar-parsed-scalars` builds from the
 * project's GraphQL schema and the `graphql.parsedScalars` setting in
 * `cedar.toml`, and puts on `globalThis.__CEDAR__PARSED_SCALARS`.
 */
export interface ParsedScalarsCacheConfig {
  /**
   * The scalars to parse, and the type each is parsed into
   */
  scalars: Record<string, string>
  /**
   * The fields that hold a parsed scalar
   */
  typePolicies: Record<string, { fields: Record<string, { scalar: string }> }>
  /**
   * The input objects that hold a parsed scalar, directly or through another
   * input object
   */
  inputObjects: Record<string, { fields: Record<string, string> }>
}

/**
 * How to turn a scalar into each type `graphql.parsedScalars` can name, and
 * back. Apollo Client uses `is` to tell a parsed value from a serialized one.
 */
const SCALAR_TYPES: Record<string, Scalar<string, unknown>> = {
  Date: new Scalar<string, Date>({
    parse: (serialized) => new Date(serialized),
    serialize: (parsed) => parsed.toISOString(),
    is: (value) => value instanceof Date,
  }),
}

type FieldPolicies = NonNullable<TypePolicies[string]['fields']>

/**
 * Adds the generated `scalar` to the field policies the app configured for the
 * same field, so both apply
 */
function mergeFieldPolicies(
  generated: Record<string, { scalar: string }>,
  configured: FieldPolicies = {},
): FieldPolicies {
  const fields: FieldPolicies = { ...configured }

  for (const [name, policy] of Object.entries(generated)) {
    const configuredPolicy = configured[name]

    // A field policy's `scalar` can only name a scalar that a project has
    // declared in `ApolloCache.Scalars`. The declaration comes from the
    // project's generated types, which `@cedarjs/web` can't see, so `scalar` is
    // typed as `undefined` here and needs the `unknown` step
    fields[name] = (typeof configuredPolicy === 'function'
      ? { ...policy, read: configuredPolicy }
      : { ...policy, ...configuredPolicy }) as unknown as FieldPolicies[string]
  }

  return fields
}

/**
 * Adds the scalars in `graphql.parsedScalars` to the cache config, so that
 * Apollo Client's cache parses them when it reads a response and serializes
 * them in a query's variables. Anything the app configured for the same
 * scalar, field or input object takes precedence. Returns the config as it is
 * when no scalar is parsed.
 */
export function withParsedScalars(
  cacheConfig?: InMemoryCacheConfig,
): InMemoryCacheConfig | undefined {
  const parsed = globalThis.__CEDAR__PARSED_SCALARS

  if (!parsed) {
    return cacheConfig
  }

  const scalars = Object.fromEntries(
    Object.entries(parsed.scalars).map(([name, type]) => {
      const scalarType = SCALAR_TYPES[type]

      if (!scalarType) {
        throw new Error(
          `Can't parse the ${name} scalar into ${JSON.stringify(type)}. ` +
            'Supported: ' +
            Object.keys(SCALAR_TYPES)
              .map((supported) => JSON.stringify(supported))
              .join(', '),
        )
      }

      return [name, scalarType]
    }),
  )

  const typePolicies: TypePolicies = { ...cacheConfig?.typePolicies }

  for (const [typeName, { fields }] of Object.entries(parsed.typePolicies)) {
    typePolicies[typeName] = {
      ...typePolicies[typeName],
      fields: mergeFieldPolicies(fields, typePolicies[typeName]?.fields),
    }
  }

  // `InMemoryCacheConfig` only lets `scalars` be set for scalars that a
  // project has declared in `ApolloCache.Scalars`. The declaration comes from
  // the project's generated types, which `@cedarjs/web` can't see, so the
  // config is built without the type check here.
  return {
    ...cacheConfig,
    scalars: { ...scalars, ...cacheConfig?.scalars },
    typePolicies,
    inputObjects: { ...parsed.inputObjects, ...cacheConfig?.inputObjects },
  } as InMemoryCacheConfig
}
