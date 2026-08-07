import React, { Suspense } from 'react'

import type { OperationVariables } from '@apollo/client'
import { CombinedGraphQLErrors } from '@apollo/client'
import type { SkipToken } from '@apollo/client/react'
import {
  skipToken,
  useApolloClient,
  useBackgroundQuery,
  useReadQuery,
} from '@apollo/client/react'

import type { FallbackProps } from './CellErrorBoundary.js'
import { CellErrorBoundary } from './CellErrorBoundary.js'
import type {
  CreateCellProps,
  DataObject,
  SuspendingSuccessProps,
  SuspenseCellQueryResult,
} from './cellTypes.js'
import { isDataEmpty } from './isCellEmpty.js'

type AnyObj = Record<string, unknown>
/**
 * Creates a Cell ~~ with Apollo Client only ~~
 * using the hooks useBackgroundQuery and useReadQuery
 *
 */
export function createSuspendingCell<
  CellProps extends AnyObj,
  CellVariables extends AnyObj,
>(
  createCellProps: CreateCellProps<AnyObj, CellVariables>, // 👈 AnyObj, because using CellProps causes a TS error
): React.FC<CellProps> {
  const {
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
    afterQuery = (data) => ({ ...data }),
    isEmpty = isDataEmpty,
    Loading,
    Failure,
    Empty,
    Success,
    displayName = 'Cell',
  } = createCellProps

  if (!QUERY) {
    throw new Error(
      `Can't create a Cell (${displayName}) without a QUERY or FRAGMENT export`,
    )
  }

  // Assigning to a `const` here (as opposed to using the destructured
  // variable directly) makes the `!QUERY` narrowing above hold inside the
  // component below
  const cellQuery = QUERY
  function SuspendingSuccess(props: SuspendingSuccessProps) {
    const { queryRef, suspenseQueryResult, userProps } = props
    // The 'complete' | 'streaming' states both type `data` as `DataObject`;
    // the Cell suspends until data is available, so we never render with
    // partial or missing data
    const { data, networkStatus } = useReadQuery<
      DataObject,
      'complete' | 'streaming'
    >(queryRef)
    const afterQueryData = afterQuery(data)

    const queryResultWithNetworkStatus: SuspenseCellQueryResult = {
      ...suspenseQueryResult,
      networkStatus,
    }

    if (isEmpty(data, { isDataEmpty }) && Empty) {
      return (
        <Empty
          {...userProps}
          {...afterQueryData}
          queryResult={queryResultWithNetworkStatus}
        />
      )
    }

    return (
      <Success
        {...afterQueryData}
        {...userProps}
        queryResult={queryResultWithNetworkStatus}
      />
    )
  }

  SuspendingSuccess.displayName = displayName

  // @NOTE: Note that we are returning a HoC here!
  return (props: CellProps) => {
    /**
     * Right now, Cells don't render `children`.
     */
    const { children: _, ...variables } = props
    const options = beforeQuery(variables)

    // `skipToken` is a symbol rather than an options object, so there's nothing
    // to hand to a `QUERY` function. While skipped the document is never
    // executed, it just has to exist to satisfy the query hook
    const query =
      typeof cellQuery === 'function'
        ? cellQuery(options === skipToken ? {} : options)
        : cellQuery
    // `beforeQuery`'s options are typed against `useQuery`, which accepts a
    // slightly wider `fetchPolicy` than `useBackgroundQuery` does. Streaming
    // Cells that set one of the extra policies aren't supported
    const backgroundQueryOptions = options as
      | SkipToken
      | useBackgroundQuery.Options<OperationVariables>

    // The query document is untyped, so Apollo Client would infer `unknown` for
    // the data. Cells treat query results as `DataObject`s, same as `useQuery`
    // is called in createCell
    const [queryRef, other] = useBackgroundQuery<DataObject>(
      query,
      backgroundQueryOptions,
    )

    const client = useApolloClient()

    // `beforeQuery` can keep the query from running, either by returning
    // `skipToken` or by setting the `skip` option. Either way there's no query
    // reference to read from, and `useReadQuery` throws when given `undefined`.
    // Like the non-suspending Cell, a skipped Cell renders nothing
    if (!queryRef) {
      return null
    }

    const suspenseQueryResult: SuspenseCellQueryResult = {
      client,
      ...other,
      called: !!queryRef,
    }

    // @TODO(STREAMING) removed prerender handling here
    // Until we decide how/if we do prerendering

    const FailureComponent = ({ error, resetErrorBoundary }: FallbackProps) => {
      if (!Failure) {
        // So that it bubbles up to the nearest error boundary
        if (error) {
          // Apollo Client types errors as `ErrorLike`, but at runtime they're
          // `Error` instances
          throw error instanceof Error ? error : new Error(error.message)
        }
        throw new Error('Unreachable code: FailureComponent without a Failure')
      }

      const queryResultWithErrorReset = {
        ...suspenseQueryResult,
        refetch: (variables: Partial<OperationVariables> | undefined) => {
          resetErrorBoundary()
          return suspenseQueryResult.refetch?.(variables)
        },
      }

      return (
        <Failure
          error={error}
          errorCode={
            CombinedGraphQLErrors.is(error)
              ? (error.errors[0]?.extensions?.['code'] as string)
              : undefined
          }
          queryResult={queryResultWithErrorReset}
        />
      )
    }

    const wrapInSuspenseIfLoadingPresent = (
      suspendingSuccessElement: React.ReactNode,
      LoadingComponent: typeof Loading,
    ) => {
      if (!LoadingComponent) {
        return suspendingSuccessElement
      }

      return (
        <Suspense
          fallback={
            <LoadingComponent {...props} queryResult={suspenseQueryResult} />
          }
        >
          {suspendingSuccessElement}
        </Suspense>
      )
    }

    return (
      <CellErrorBoundary renderFallback={FailureComponent}>
        {wrapInSuspenseIfLoadingPresent(
          <SuspendingSuccess
            userProps={props}
            queryRef={queryRef}
            suspenseQueryResult={suspenseQueryResult}
          />,
          Loading,
        )}
      </CellErrorBoundary>
    )
  }
}
