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
    args?: FindManyArgs<any> | FindUniqueArgs<any> | FindFirstArgs<any>,
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
  private captureQuery<T, TDb extends object = DatabaseClient>(
    queryFn: QueryFunction<T, TDb>,
  ): CapturedQuery | null {
    let capturedQuery: CapturedQuery | null = null

    // Create proxy database client
    const proxyDb = this.createProxyDatabase<TDb>((model, operation, args) => {
      capturedQuery = { model, operation, args }
      return {} // Return empty object to satisfy type requirements
    })

    try {
      // Execute the query function with our proxy
      queryFn(proxyDb)
      return capturedQuery
    } catch (error) {
      throw new QueryBuilderError(
        'Failed to capture query from function',
        error as Error,
      )
    }
  }

  /**
   * Create a proxy database client that captures method calls
   */
  private createProxyDatabase<TDb extends object = DatabaseClient>(
    onQuery: (model: string, operation: QueryOperation, args?: any) => void,
  ): TDb {
    return new Proxy({} as DatabaseClient, {
      get: (_, modelName) => {
        if (typeof modelName !== 'string') {
          return undefined
        }

        // Return a model delegate proxy
        return this.createModelDelegate(modelName, onQuery)
      },
    }) as TDb
  }

  /**
   * Create a proxy model delegate that captures method calls
   */
  private createModelDelegate(
    model: string,
    onQuery: (model: string, operation: QueryOperation, args?: any) => void,
  ): ModelDelegate<any> {
    const operations: readonly QueryOperation[] = [
      'findMany',
      'findUnique',
      'findFirst',
      'findUniqueOrThrow',
      'findFirstOrThrow',
    ] as const

    // There are ways to get around `any` here, but they all made the code
    // either very verbose/repetetive, or they made the code much more difficult
    // to understand.
    const delegate: any = {}

    for (const operation of operations) {
      delegate[operation] = (args?: any) => {
        onQuery(model, operation, args)
        // Return empty array to satisfy type
        return Promise.resolve([])
      }
    }

    return delegate
  }

  /**
   * Parse AST from query (exposed for advanced usage)
   */
  parseAST(
    model: string,
    operation: QueryOperation,
    args?: FindManyArgs<any> | FindUniqueArgs<any> | FindFirstArgs<any>,
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
  args?: any
}

// Default query builder instance
export const queryBuilder = new QueryBuilder()

// Convenience functions using the default instance
export function buildQuery(
  model: string,
  operation: QueryOperation,
  args?: FindManyArgs<any> | FindUniqueArgs<any> | FindFirstArgs<any>,
  options?: { isLive?: boolean },
): GraphQLQuery {
  return queryBuilder.build(model, operation, args, options)
}

export function buildQueryFromFunction<T, TDb extends object = FrameworkDbClient>(
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
  args?: FindManyArgs<any> | FindUniqueArgs<any> | FindFirstArgs<any>,
): GraphQLQuery {
  return queryBuilder.build(model, operation, args, { isLive: true })
}

/**
 * Build a live GraphQL query from a query function (convenience function)
 */
export function buildLiveQueryFromFunction<
  T,
  TDb extends object = FrameworkDbClient,
>(
  queryFn: QueryFunction<T, TDb>,
): GraphQLQuery {
  return queryBuilder.buildFromFunction(queryFn, { isLive: true })
}

// Export types and errors
export { GraphQLGenerateError, QueryParseError }

export type { GraphQLQuery, QueryAST, QueryOperation, ModelSchema }
