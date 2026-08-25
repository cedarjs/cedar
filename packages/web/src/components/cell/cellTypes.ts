import type { ComponentProps, JSX, JSXElementConstructor } from 'react'

import type {
  ApolloClient,
  NetworkStatus,
  OperationVariables,
  TypedDocumentNode,
} from '@apollo/client'
import type {
  QueryRef,
  SkipToken,
  useBackgroundQuery,
  useQuery,
} from '@apollo/client/react'
import type { DocumentNode } from 'graphql'
import type { A, L, O, U } from 'ts-toolbelt'

/**
 * If the Cell has a `beforeQuery` function, then the variables are not required,
 * but instead the arguments of the `beforeQuery` function are required. If
 * `beforeQuery` takes no arguments, or its first argument is untyped, any
 * props are accepted.
 *
 * If the Cell does not have a `beforeQuery` function, then the variables are required.
 *
 * Note that a query that doesn't take any variables is defined as {[x: string]: never}
 * The ternary at the end makes sure we don't include it, otherwise it won't allow merging any
 * other custom props from the Success component.
 */
type CellPropsVariables<Cell, GQLVariables> = Cell extends {
  beforeQuery: (...args: any[]) => any
}
  ? Parameters<Cell['beforeQuery']> extends [infer FirstArg, ...any[]]
    ? // `unknown extends T` is only true for `unknown` and `any`, i.e. an
      // untyped first argument
      unknown extends FirstArg
      ? Record<string, unknown>
      : FirstArg
    : Record<string, unknown>
  : GQLVariables extends Record<string, never>
    ? unknown
    : GQLVariables

/**
 * Cell component props which is the combination of query variables and Success props.
 */
export type CellProps<
  CellSuccess extends keyof JSX.IntrinsicElements | JSXElementConstructor<any>,
  GQLResult,
  CellType,
  GQLVariables,
> = A.Compute<
  Omit<
    ComponentProps<CellSuccess>,
    | keyof CellPropsVariables<CellType, GQLVariables>
    // Success components are typically annotated with the query's variables
    // (via `CellSuccessProps<TData, TVariables>`). When a `beforeQuery`
    // computes the variables from different props, the variables must not
    // leak into the props required at the Cell's call site, so they're
    // omitted here. Without a `beforeQuery` this is a no-op since
    // `CellPropsVariables` already equals the variables. `keyof unknown` is
    // `never`, so queries without variables are unaffected.
    | keyof (GQLVariables extends Record<string, never>
        ? unknown
        : GQLVariables)
    | keyof GQLResult
    | 'updating'
    | 'queryResult'
  > &
    CellPropsVariables<CellType, GQLVariables>
>

// `unknown extends T` is only true for `unknown`/`any` and is non-distributive
// in this position. Without this guard, when `T` is `any` the conditional
// below distributes over `any`'s implicit `unknown | {}` union, resolving to
// `unknown | any` = `any` -- which then poisons any intersection it's used
// in (`X & any` = `any`), silently disabling all prop checking.
type InputVarProps<T> = unknown extends T
  ? unknown
  : T extends { [key: string]: never }
    ? unknown
    : T

export type CellLoadingProps<TVariables extends OperationVariables = any> = {
  queryResult?:
    | NonSuspenseCellQueryResult<TVariables, any>
    | SuspenseCellQueryResult
} & InputVarProps<TVariables>

export type CellFailureProps<TVariables extends OperationVariables = any> = {
  queryResult?:
    | NonSuspenseCellQueryResult<TVariables, any>
    | SuspenseCellQueryResult
  error?: useQuery.Result['error'] | Error // for tests and storybook

  /**
   * @see {@link https://www.apollographql.com/docs/apollo-server/data/errors/#error-codes}
   */
  errorCode?: string
  updating?: boolean
} & InputVarProps<TVariables>

// aka guarantee that all properties in T exist
type Guaranteed<T> = {
  [K in keyof T]-?: NonNullable<T[K]>
}

type KeyCount<T extends object> = L.Length<U.ListOf<O.SelectKeys<T, any>>>

// This is used for the Success component in Cells. If there is only one thing
// being returned by the Cell we can guarantee that the data is not null or
// undefined. If there are are multiple roots we can't guarantee that because
// the default isEmpty check only makes sure there is _some_ data – not that
// all properties have data
// NOTE: This only holds true for Cells as Redwood generates them. If the user
// removes the <Empty> component, or provides their own isEmpty implementation
// there's no way for us to know what the data will look like.
type ConditionallyGuaranteed<T extends object> =
  KeyCount<T> extends 1 ? Guaranteed<T> : T

/**
 * @param TData - Type of data based on your graphql query. This can be imported
 * from 'types/graphql'
 *
 * @example
 * import type { FindPosts } from 'types/graphql'
 *
 * const { post }: CellSuccessData<FindPosts> = props
 */
export type CellSuccessData<TData = any> = ConditionallyGuaranteed<
  Omit<TData, '__typename'>
>

/**
 * @MARK not sure about this partial, but we need to do this for tests and storybook.
 *
 * `updating` is just `loading` renamed; since Cells default to stale-while-refetch,
 * this prop lets users render something like a spinner to show that a request is in-flight.
 */

export type CellSuccessProps<
  TData = any,
  TVariables extends OperationVariables = any,
> = {
  queryResult?:
    | NonSuspenseCellQueryResult<TVariables, TData>
    | SuspenseCellQueryResult
  updating?: boolean
} & InputVarProps<TVariables> &
  // pre-computing makes the types more readable on hover
  A.Compute<CellSuccessData<TData>>

/**
 * A coarse type for the `data` prop returned by `useQuery`.
 *
 * ```js
 * {
 *   data: {
 *     post: { ... }
 *   }
 * }
 * ```
 */
export type DataObject = { [key: string]: unknown }

/**
 * What `beforeQuery` returns is handed straight to the GraphQL client's query
 * hook, so any of that hook's options can be set here.
 */
export type CellBeforeQueryOptions<CellVariables> = {
  variables: CellVariables
} & Omit<useQuery.Options<DataObject, OperationVariables>, 'variables'>

/**
 * `beforeQuery` can return `skipToken` instead of an options object to keep the
 * query from being executed at all. A skipped Cell renders nothing -- none of
 * `Loading`, `Empty`, `Failure` or `Success` are rendered.
 *
 * @see {@link https://www.apollographql.com/docs/react/api/react/hooks#skiptoken}
 *
 * @example
 * ```ts
 * import { skipToken } from '@apollo/client/react'
 *
 * export const beforeQuery = ({ id }) => {
 *   const otherId = useStore((state) => state.getOther(id))
 *
 *   return otherId ? { variables: { id, otherId } } : skipToken
 * }
 * ```
 */
export type CellBeforeQueryResult<CellVariables> =
  | CellBeforeQueryOptions<CellVariables>
  | SkipToken

/**
 * The main interface.
 *
 * @param GQLResult - The shape of the data returned by `QUERY` (or, for
 * fragment Cells, the shape of the fragment's data). This is what
 * `Success`/`Empty` receive their data as. Defaults to `any` so Cells that
 * don't -- or can't -- type their `QUERY` with `TypedDocumentNode` (e.g. in
 * tests, or Cells built from a plain string) keep the pre-existing loose
 * behavior instead of erroring.
 */
export interface CreateCellProps<
  CellProps,
  CellVariables extends OperationVariables = OperationVariables,
  GQLResult = any,
> {
  /**
   * The GraphQL syntax tree to execute or function to call that returns it.
   * If `QUERY` is a function, it's called with the result of `beforeQuery`.
   *
   * Either `QUERY` or `FRAGMENT` must be provided.
   */
  QUERY?:
    | TypedDocumentNode<GQLResult, CellVariables>
    | DocumentNode
    | ((variables: Record<string, unknown>) => DocumentNode)
  /**
   * A GraphQL fragment that declares this Cell's data requirements. Fragment
   * Cells don't fire their own query. Instead a parent Cell spreads the
   * fragment in its `QUERY` and passes the fetched data object down via a
   * prop named after the fragment (`AuthorCell_author` -> `author`). The
   * fragment is automatically registered with the GraphQL client's fragment
   * registry, so parent queries can spread it by name.
   *
   * Either `QUERY` or `FRAGMENT` must be provided.
   */
  FRAGMENT?: DocumentNode
  /**
   * Parse `props` into query variables. Most of the time `props` are appropriate variables as is.
   *
   * Any other option the GraphQL client's query hook accepts can be returned
   * here as well. Return `skipToken` to not execute the query at all.
   */
  beforeQuery?:
    | ((props: CellProps) => CellBeforeQueryResult<CellVariables>)
    | (() => CellBeforeQueryResult<CellVariables>)
  /**
   * Sanitize the data returned from the query.
   */
  afterQuery?: (data: DataObject) => DataObject
  /**
   * How to decide if the result of a query should render the `Empty` component.
   * The default implementation checks that the first field isn't `null` or an empty array.
   *
   * @example
   *
   * In the example below, only `users` is checked:
   *
   * ```js
   * export const QUERY = gql`
   *   users {
   *     name
   *   }
   *   posts {
   *     title
   *   }
   * `
   * ```
   */
  isEmpty?: (
    response: DataObject,
    options: {
      isDataEmpty: (data: DataObject) => boolean
    },
  ) => boolean
  /**
   * If the query's in flight and there's no stale data, render this.
   */
  Loading?: React.FC<CellLoadingProps<CellVariables> & Partial<CellProps>>
  /**
   * If something went wrong, render this.
   */
  Failure?: React.FC<CellFailureProps<CellVariables> & Partial<CellProps>>
  /**
   * If no data was returned, render this.
   */
  Empty?: React.FC<
    CellSuccessProps<GQLResult, CellVariables> & Partial<CellProps>
  >
  /**
   * If data was returned, render this.
   */
  Success: React.FC<
    CellSuccessProps<GQLResult, CellVariables> & Partial<CellProps>
  >
  /**
   * What to call the Cell. Defaults to the filename.
   */
  displayName?: string
}

export type SuspendingSuccessProps = React.PropsWithChildren<
  Record<string, unknown>
> & {
  queryRef: QueryRef<DataObject> // from useBackgroundQuery
  suspenseQueryResult: SuspenseCellQueryResult<DataObject, any>
  userProps: Record<string, any> // we don't really care about the types here, we are just forwarding on
}

export type NonSuspenseCellQueryResult<
  TVariables extends OperationVariables = any,
  TData = any,
> = Partial<
  Omit<useQuery.Result<TData, TVariables>, 'loading' | 'error' | 'data'>
>

// We call this queryResult in createCell, sadly a very overloaded term
// This is just the extra things returned from useXQuery hooks
export interface SuspenseCellQueryResult<
  _TData = any,
  _TVariables extends OperationVariables = any,
> extends useBackgroundQuery.Result<DataObject> {
  client: ApolloClient
  // fetchMore & refetch come from useBackgroundQuery.Result
  networkStatus?: NetworkStatus
  called: boolean // set if queryRef present
}
