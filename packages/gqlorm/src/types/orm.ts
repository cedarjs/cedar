/**
 * ORM query interface types that define the Prisma-like API surface
 * These types represent the input format that users will write
 */

export type Scalar = string | number | boolean | Date | null

// Comparison operators for where conditions
export interface StringFilter {
  equals?: string
  not?: string | StringFilter
  in?: string[]
  notIn?: string[]
  lt?: string
  lte?: string
  gt?: string
  gte?: string
  contains?: string
  startsWith?: string
  endsWith?: string
}

export interface NumberFilter {
  equals?: number
  not?: number | NumberFilter
  in?: number[]
  notIn?: number[]
  lt?: number
  lte?: number
  gt?: number
  gte?: number
}

export interface BooleanFilter {
  equals?: boolean
  not?: boolean | BooleanFilter
}

export interface DateFilter {
  equals?: Date
  not?: Date | DateFilter
  in?: Date[]
  notIn?: Date[]
  lt?: Date
  lte?: Date
  gt?: Date
  gte?: Date
}

export type Filter<T> = T extends string
  ? string | StringFilter
  : T extends number
    ? number | NumberFilter
    : T extends boolean
      ? boolean | BooleanFilter
      : T extends Date
        ? Date | DateFilter
        : T extends null
          ? null
          : never

export interface LogicalOperators<T> {
  AND?: T[]
  OR?: T[]
  NOT?: T
}

// Base where clause type
export type WhereInput<T> = {
  [K in keyof T]?: Filter<T[K]>
} & LogicalOperators<WhereInput<T>>

// Flexible where input for proxy scenarios - allows any property structure
export type FlexibleWhereInput = {
  [key: string]: any
  AND?: FlexibleWhereInput[]
  OR?: FlexibleWhereInput[]
  NOT?: FlexibleWhereInput
}

// Union type that works for both typed and untyped scenarios
export type AnyWhereInput<T = any> =
  T extends Record<string, any> ? WhereInput<T> : FlexibleWhereInput

// Order by direction
export type SortOrder = 'asc' | 'desc'

// Order by input
export type OrderByInput<T> = {
  [K in keyof T]?: SortOrder
}

// Select input - true to include, false to exclude
export type SelectInput<T> = {
  [K in keyof T]?: boolean
}

// Include input for relations
export type IncludeInput<T = any> = {
  [K in keyof T]?:
    | boolean
    | {
        select?: SelectInput<any>
        include?: IncludeInput<any>
        where?: AnyWhereInput<any>
        orderBy?: OrderByInput<any>
        take?: number
        skip?: number
      }
} & {
  [key: string]:
    | boolean
    | {
        select?: SelectInput<any>
        include?: IncludeInput<any>
        where?: AnyWhereInput<any>
        orderBy?: OrderByInput<any>
        take?: number
        skip?: number
      }
}

export interface BaseQueryArgs<T = any> {
  where?: AnyWhereInput<T>
  select?: SelectInput<T>
  include?: IncludeInput<T>
  orderBy?: OrderByInput<T> | OrderByInput<T>[]
}

export interface FindManyArgs<T> extends BaseQueryArgs<T> {
  take?: number
  skip?: number
}

export interface FindUniqueArgs<T> {
  where: WhereUniqueInput<T>
  select?: SelectInput<T>
  include?: IncludeInput<T>
}

// Same as FindManyArgs but returns single result
export type FindFirstArgs<T> = BaseQueryArgs<T>

// Where unique input (for findUnique operations)
export type WhereUniqueInput<T> = {
  [K in keyof T]?: T[K]
}

// Model delegate interface - represents db.model methods
export interface ModelDelegate<T = any> {
  findMany(args?: FindManyArgs<T>): Promise<T[]>
  findUnique(args: FindUniqueArgs<T>): Promise<T | null>
  findFirst(args?: FindFirstArgs<T>): Promise<T | null>
  findUniqueOrThrow(args: FindUniqueArgs<T>): Promise<T>
  findFirstOrThrow(args?: FindFirstArgs<T>): Promise<T>

  // Future: mutation methods
  // create(args: CreateArgs<T>): Promise<T>;
  // update(args: UpdateArgs<T>): Promise<T>;
  // delete(args: DeleteArgs<T>): Promise<T>;
  // upsert(args: UpsertArgs<T>): Promise<T>;
}

// Database client interface - flexible for proxy-based implementation
export interface DatabaseClient {
  [modelName: string]: ModelDelegate<any>
}

/**
 * Framework-level type map that can be module-augmented by Cedar generated
 * types. This lets Cedar inject `typeof db` without users writing wrappers.
 *
 * Example augmentation:
 * declare module '@cedarjs/gqlorm/types/orm' {
 *   interface GqlormTypeMap {
 *     db: typeof db
 *   }
 * }
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface GqlormTypeMap {}

type DefaultDbClient = GqlormTypeMap extends { db: infer TDb }
  ? TDb
  : DatabaseClient

type ModelDelegatePropertyName<TDb> = {
  [K in keyof TDb]-?: K extends string
    ? K extends `$${string}`
      ? never
      : TDb[K] extends ModelDelegate<any>
        ? K
        : never
    : never
}[keyof TDb]

export type ModelDelegatesOnly<TDb> = [ModelDelegatePropertyName<TDb>] extends [
  never,
]
  ? DatabaseClient
  : Pick<TDb, ModelDelegatePropertyName<TDb>>

export type FrameworkDbClient = ModelDelegatesOnly<DefaultDbClient>

// Query context interface (what gets passed to query functions)
export interface QueryContext<TDb extends object = FrameworkDbClient> {
  db: TDb
}

// Query function type (used in useLiveQuery hook)
export type QueryFunction<T, TDb extends object = FrameworkDbClient> = (
  db: TDb,
) => Promise<T> | T

// Result types with metadata
export interface QueryResult<T> {
  data: T
  loading: boolean
  error?: Error
}

export interface PaginatedResult<T> {
  data: T[]
  pageInfo: {
    hasNextPage: boolean
    hasPreviousPage: boolean
    startCursor?: string
    endCursor?: string
  }
  totalCount?: number
}
