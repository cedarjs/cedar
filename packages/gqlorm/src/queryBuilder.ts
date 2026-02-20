/**
 * Main query builder entry point that combines parsing and generation
 * This is the primary API that users will interact with
 */

import {
  GraphQLGenerateError,
  GraphQLGenerator,
} from './generator/graphqlGenerator.js'
import type { GraphQLQuery } from './generator/graphqlGenerator.js'
import { QueryParseError, QueryParser } from './parser/queryParser.js'
import type { QueryAST, QueryOperation } from './types/ast.js'
import {
  type DatabaseClient,
  type FindFirstArgs,
  type FindManyArgs,
  type FindUniqueArgs,
  type FrameworkDbClient,
  type ModelDelegate,
  type QueryFunction,
} from './types/orm.js'
import type { ModelSchema } from './types/schema.js'

export class QueryBuilderError extends Error {
  constructor(
    message: string,
    public override cause?: Error,
  ) {
    super(message)
    this.name = 'QueryBuilderError'
  }
}

type GenericQueryArgs =
  | FindManyArgs<unknown>
  | FindUniqueArgs<unknown>
  | FindFirstArgs<unknown>

export interface QueryBuilderOptions {
  /**
   * Whether to validate queries against schema (future feature)
   */
  readonly validateSchema?: boolean

  /**
   * Whether to optimize queries (future feature)
   */
  readonly optimizeQueries?: boolean

  /**
   * Custom field name mappings (future feature)
   */
  fieldMappings?: Record<string, string>

  /**
   * Whether to automatically add @live directive to queries
   * @default false
   */
  readonly enableLiveQueries?: boolean

  /**
   * Whether to force @live directive on all queries (overrides
   * enableLiveQueries)
   * @default false
   */
  readonly forceLiveQueries?: boolean

  /**
   * Model schema defining scalar fields for each model
   */
  readonly schema?: ModelSchema
}

export class QueryBuilder {
  readonly #parser = new QueryParser()
  readonly #generator: GraphQLGenerator
  #options: QueryBuilderOptions

  constructor(options: QueryBuilderOptions = {}) {
    this.#options = structuredClone(options)
    this.#generator = new GraphQLGenerator(options.schema)
  }

  /**
   * Build GraphQL query from ORM-style query
   */
  build(
    model: string,
    operation: QueryOperation,
    args?: GenericQueryArgs,
    options?: { isLive?: boolean },
  ): GraphQLQuery {
    try {
      // Parse ORM query to AST
      const ast = this.#parser.parseQuery(model, operation, args)

      // Determine if this should be a live query
      const isLive = this.#shouldUseLiveQuery(options?.isLive)
      if (isLive) {
        ast.isLive = true
      }

      this.#parser.validateAST(ast)

      const graphqlQuery = this.#generator.generate(ast)

      return graphqlQuery
    } catch (error) {
      if (
        error instanceof QueryParseError ||
        error instanceof GraphQLGenerateError
      ) {
        throw new QueryBuilderError(
          `Failed to build query: ${error.message}`,
          error,
        )
      }

      throw error
    }
  }

  /**
   * Build GraphQL query from a query function (used with useLiveQuery)
   */
  buildFromFunction<T, TDb extends object = FrameworkDbClient>(
    queryFn: QueryFunction<T, TDb>,
    options?: { isLive?: boolean },
  ): GraphQLQuery
  buildFromFunction<T>(
    queryFn: QueryFunction<T, object>,
    options?: { isLive?: boolean },
  ): GraphQLQuery {
    // Create a proxy database client that captures method calls
    const capturedQuery = this.captureQuery(queryFn)

    if (!capturedQuery) {
      throw new QueryBuilderError(
        'No query was captured from the provided function',
      )
    }

    return this.build(
      capturedQuery.model,
      capturedQuery.operation,
      capturedQuery.args,
      options,
    )
  }

  /**
   * Capture query details from a query function using a proxy
   */
  private captureQuery<T>(
    queryFn: QueryFunction<T, object>,
  ): CapturedQuery | null {
    let capturedQuery: CapturedQuery | null = null

    // Create proxy database client
    const proxyDb = this.createProxyDatabase((model, operation, args) => {
      capturedQuery = { model, operation, args }
      return {}
    })

    try {
      // Execute the query function with our proxy
      queryFn(proxyDb)
      return capturedQuery
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error))
      throw new QueryBuilderError('Failed to capture query from function', e)
    }
  }

  /**
   * Create a proxy database client that captures method calls
   */
  private createProxyDatabase(
    onQuery: (
      model: string,
      operation: QueryOperation,
      args?: GenericQueryArgs,
    ) => void,
  ): DatabaseClient {
    const proxyTarget = {}

    return new Proxy(proxyTarget, {
      get: (_, modelName) => {
        if (typeof modelName !== 'string') {
          return undefined
        }

        // Return a model delegate proxy
        return this.createModelDelegate(modelName, onQuery)
      },
    })
  }

  /**
   * Create a proxy model delegate that captures method calls
   */
  private createModelDelegate(
    model: string,
    onQuery: (
      model: string,
      operation: QueryOperation,
      args?: GenericQueryArgs,
    ) => void,
  ): ModelDelegate<unknown> {
    return {
      findMany: (args?: FindManyArgs<unknown>) => {
        onQuery(model, 'findMany', args)
        return Promise.resolve([])
      },
      findUnique: (args: FindUniqueArgs<unknown>) => {
        onQuery(model, 'findUnique', args)
        return Promise.resolve(null)
      },
      findFirst: (args?: FindFirstArgs<unknown>) => {
        onQuery(model, 'findFirst', args)
        return Promise.resolve(null)
      },
      findUniqueOrThrow: (args: FindUniqueArgs<unknown>) => {
        onQuery(model, 'findUniqueOrThrow', args)
        return Promise.resolve(undefined)
      },
      findFirstOrThrow: (args?: FindFirstArgs<unknown>) => {
        onQuery(model, 'findFirstOrThrow', args)
        return Promise.resolve(undefined)
      },
    }
  }

  /**
   * Parse AST from query (exposed for advanced usage)
   */
  parseAST(
    model: string,
    operation: QueryOperation,
    args?: GenericQueryArgs,
  ): QueryAST {
    try {
      return this.#parser.parseQuery(model, operation, args)
    } catch (error) {
      if (error instanceof QueryParseError) {
        throw new QueryBuilderError(
          `Failed to parse query: ${error.message}`,
          error,
        )
      }
      throw error
    }
  }

  /**
   * Generate GraphQL from AST (exposed for advanced usage)
   */
  generateGraphQL(ast: QueryAST): GraphQLQuery {
    try {
      return this.#generator.generate(ast)
    } catch (error) {
      if (error instanceof GraphQLGenerateError) {
        throw new QueryBuilderError(
          `Failed to generate GraphQL: ${error.message}`,
          error,
        )
      }
      throw error
    }
  }

  /**
   * Get query builder options
   */
  getOptions(): QueryBuilderOptions {
    return structuredClone(this.#options)
  }

  /**
   * Update query builder options
   */
  updateOptions(newOptions: Partial<QueryBuilderOptions>): void {
    this.#options = { ...this.#options, ...newOptions }
  }

  /**
   * Determine if a query should use @live directive
   */
  #shouldUseLiveQuery(explicitIsLive?: boolean): boolean {
    // Explicit override takes precedence
    if (explicitIsLive !== undefined) {
      return explicitIsLive
    }

    // Force live queries if configured
    if (this.#options.forceLiveQueries) {
      return true
    }

    // Use live queries if enabled
    return this.#options.enableLiveQueries || false
  }
}

// Internal interface for captured query details
interface CapturedQuery {
  model: string
  operation: QueryOperation
  args?: GenericQueryArgs
}

// Default query builder instance
export const queryBuilder = new QueryBuilder()

// Convenience functions using the default instance
export function buildQuery(
  model: string,
  operation: QueryOperation,
  args?: GenericQueryArgs,
  options?: { isLive?: boolean },
): GraphQLQuery {
  return queryBuilder.build(model, operation, args, options)
}

export function buildQueryFromFunction<
  T,
  TDb extends object = FrameworkDbClient,
>(
  queryFn: QueryFunction<T, TDb>,
  options?: { isLive?: boolean },
): GraphQLQuery {
  return queryBuilder.buildFromFunction(queryFn, options)
}

/**
 * Build a live GraphQL query from ORM-style query (convenience function)
 */
export function buildLiveQuery(
  model: string,
  operation: QueryOperation,
  args?: GenericQueryArgs,
): GraphQLQuery {
  return queryBuilder.build(model, operation, args, { isLive: true })
}

/**
 * Build a live GraphQL query from a query function (convenience function)
 */
export function buildLiveQueryFromFunction<
  T,
  TDb extends object = FrameworkDbClient,
>(queryFn: QueryFunction<T, TDb>): GraphQLQuery {
  return queryBuilder.buildFromFunction(queryFn, { isLive: true })
}

// Export types and errors
export { GraphQLGenerateError, QueryParseError }

export type { GraphQLQuery, QueryAST, QueryOperation, ModelSchema }
