import React from 'react'

import { CombinedGraphQLErrors } from '@apollo/client'
import { useQuery } from '@apollo/client/react'

import { fragmentRegistry } from '../../apollo/fragmentRegistry.js'
import { getOperationName } from '../../graphql.js'

import { useCellCacheContext } from './CellCacheContext.js'
import type { CreateCellProps, DataObject } from './cellTypes.js'
import { createFragmentCell } from './createFragmentCell.js'
import { createSuspendingCell } from './createSuspendingCell.js'
import { isDataEmpty } from './isCellEmpty.js'

export function createCell<
  CellProps extends Record<string, unknown>,
  CellVariables extends Record<string, unknown>,
>(
  createCellProps: CreateCellProps<CellProps, CellVariables>,
): React.FC<CellProps> {
  // Cells that declare their data requirements with a FRAGMENT don't fire
  // queries of their own – they read their slice of a parent Cell's query
  // result via a prop named after the fragment. If a Cell exports both QUERY
  // and FRAGMENT it stays a query Cell (the FRAGMENT export might just be a
  // helper for other Cells to spread)
  if (createCellProps.FRAGMENT) {
    if (!createCellProps.QUERY) {
      return createFragmentCell(createCellProps)
    }

    // The Cell stays a query Cell, but other Cells might still spread its
    // FRAGMENT export by name, so it has to be registered (createFragmentCell
    // handles registration for fragment Cells)
    fragmentRegistry.register(createCellProps.FRAGMENT)
  }

  // 👇 Note how we switch which cell factory to use!
  if (RWJS_ENV.RWJS_EXP_STREAMING_SSR) {
    // createSuspendingCell types its argument with `Record<string, unknown>`
    // instead of the Cell's own props type (see the note in its
    // implementation), so the generics don't line up even though the runtime
    // shape is identical. The returned component is re-typed with this Cell's
    // props.
    const suspendingCellProps = createCellProps as CreateCellProps<
      Record<string, unknown>,
      CellVariables
    >

    return createSuspendingCell<CellProps, CellVariables>(suspendingCellProps)
  }

  return createNonSuspendingCell(createCellProps)
}

/**
 * Creates a Cell out of a GraphQL query and components that track to its lifecycle.
 */
function createNonSuspendingCell<
  CellProps extends Record<string, unknown>,
  CellVariables extends Record<string, unknown>,
>({
  QUERY,
  beforeQuery = (props) => ({
    // By default, we assume that the props are the gql-variables.
    variables: props as unknown as CellVariables,
    /**
     * We're duplicating these props here due to a suspected bug in Apollo Client v3.5.4
     * (it doesn't seem to be respecting `defaultOptions` in `RedwoodApolloProvider`.)
     *
     * @see {@link https://github.com/apollographql/apollo-client/issues/9105}
     */
    fetchPolicy: 'cache-and-network',
    notifyOnNetworkStatusChange: true,
  }),
  afterQuery = (data) => data,
  isEmpty = isDataEmpty,
  Loading = () => <>Loading...</>,
  Failure,
  Empty,
  Success,
  displayName = 'Cell',
}: CreateCellProps<CellProps, CellVariables>): React.FC<CellProps> {
  if (!QUERY) {
    throw new Error(
      `Can't create a Cell (${displayName}) without a QUERY or FRAGMENT export`,
    )
  }

  // Assigning to a `const` here (as opposed to using the destructured
  // parameter directly) makes the `!QUERY` narrowing above hold inside
  // `NamedCell` below
  const cellQuery = QUERY

  function NamedCell(props: React.PropsWithChildren<CellProps>) {
    /**
     * Right now, Cells don't render `children`.
     */
    const { children: _, ...variables } = props
    const options = beforeQuery(variables as CellProps)
    const query =
      typeof cellQuery === 'function' ? cellQuery(options) : cellQuery

    // queryRest includes `variables: { ... }`, with any variables returned
    // from beforeQuery
    let {
      // eslint-disable-next-line prefer-const
      error,
      loading,
      data,
      ...queryResult
    } = useQuery<DataObject>(query, options)

    if (globalThis.__REDWOOD__PRERENDERING) {
      // __REDWOOD__PRERENDERING will always either be set, or not set. So
      // rules-of-hooks are still respected, even though we wrap this in an if
      // statement
      /* eslint-disable-next-line react-hooks/rules-of-hooks */
      const { queryCache } = useCellCacheContext()
      const operationName = getOperationName(query)
      const transformedQuery = fragmentRegistry.transform(query)

      let cacheKey

      if (operationName) {
        cacheKey = operationName + '_' + JSON.stringify(variables)
      } else {
        const cellName = displayName === 'Cell' ? 'the cell' : displayName

        throw new Error(
          `The gql query in ${cellName} is missing an operation name. ` +
            'Something like FindBlogPostQuery in ' +
            '`query FindBlogPostQuery($id: Int!)`',
        )
      }

      const queryInfo = queryCache[cacheKey]

      // This is true when the graphql handler couldn't be loaded
      // So we fallback to the loading state
      if (queryInfo?.renderLoading) {
        loading = true
      } else {
        if (queryInfo?.hasProcessed) {
          loading = false
          // The prerender query cache stores the untyped result of executing
          // this Cell's query, so it has the `DataObject` shape
          data = queryInfo.data as DataObject

          // All of the gql client's props aren't available when pre-rendering,
          // so using `any` here
          queryResult = { variables } as any
        } else {
          queryCache[cacheKey] ||= {
            query: transformedQuery,
            variables: options.variables,
            hasProcessed: false,
          }
        }
      }
    }

    if (error) {
      if (Failure) {
        // errorCode is not part of the type returned by useQuery
        // but it is returned as part of the queryResult
        type QueryResultWithErrorCode = typeof queryResult & {
          errorCode: string
        }

        return (
          <Failure
            error={error}
            errorCode={
              // Use the ad-hoc QueryResultWithErrorCode type to access the errorCode
              (queryResult as QueryResultWithErrorCode).errorCode ??
              (CombinedGraphQLErrors.is(error)
                ? (error.errors[0]?.extensions?.['code'] as string)
                : undefined)
            }
            {...props}
            updating={loading}
            queryResult={queryResult}
          />
        )
      } else {
        // Apollo Client types errors as `ErrorLike`, but at runtime they're
        // `Error` instances
        throw error instanceof Error ? error : new Error(error.message)
      }
    } else if (data) {
      const afterQueryData = afterQuery(data)

      if (isEmpty(data, { isDataEmpty }) && Empty) {
        return (
          <Empty
            {...props}
            {...afterQueryData}
            updating={loading}
            queryResult={queryResult}
          />
        )
      } else {
        return (
          <Success
            {...props}
            {...afterQueryData}
            updating={loading}
            queryResult={queryResult}
          />
        )
      }
    } else if (loading) {
      return <Loading {...props} queryResult={queryResult} />
    } else {
      /**
       * There really shouldn't be an `else` here, but like any piece of software, GraphQL clients have bugs.
       * If there's no `error` and there's no `data` and we're not `loading`, something's wrong. Most likely with the cache.
       *
       * @see {@link https://github.com/redwoodjs/redwood/issues/2473#issuecomment-971864604}
       */
      console.warn(
        `If you're using Apollo Client, check for its debug logs here in the console, which may help explain the error.`,
      )
      throw new Error(
        'Cannot render Cell: reached an unexpected state where the query succeeded but `data` is `null`. If this happened in Storybook, your query could be missing fields; otherwise this is most likely a GraphQL caching bug. Note that adding an `id` field to all the fields on your query may fix the issue.',
      )
    }
  }

  NamedCell.displayName = displayName

  return (props: CellProps) => {
    return <NamedCell {...props} />
  }
}
