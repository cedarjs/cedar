import React, { Suspense } from 'react'

import type { OperationVariables } from '@apollo/client'
import { CombinedGraphQLErrors } from '@apollo/client'
import type { SkipToken } from '@apollo/client/react'
import {
  useApolloClient,
  useBackgroundQuery,
  useReadQuery,
} from '@apollo/client/react'

import type { FallbackProps } from './CellErrorBoundary.js'
import { CellErrorBoundary } from './CellErrorBoundary.js'
import type {
  CellBeforeQueryResult,
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
  CellVariables extends OperationVariables = OperationVariables,
  GQLResult = any,
>(
  createCellProps: CreateCellProps<AnyObj, CellVariables, GQLResult>, // 👈 AnyObj, because using CellProps causes a TS error
): React.FC<CellProps> {
  const {
    QUERY,
    // Unlike in createCell this is destructured from a variable rather than
    // from an annotated parameter, so the default's return type has to be
    // spelled out. Without it the inferred object literal type widens the
    // union and options like `skip` are no longer visible on it
    beforeQuery = (props): CellBeforeQueryResult<CellVariables> => ({
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

    // `Empty`/`Success` are checked against this Cell's real `GQLResult` and
    // `CellVariables` at its own call site. Inside this generic factory
    // function those are still abstract, and there's no way for TS to verify
    // structurally that `userProps`/`afterQueryData` line up with them, so
    // the merged props are asserted here rather than checked (see the same
    // pattern, with more detail, in createCell.tsx)
    if (isEmpty(data, { isDataEmpty }) && Empty) {
      const emptyProps = {
        ...userProps,
        ...afterQueryData,
        queryResult: queryResultWithNetworkStatus,
      }

      return <Empty {...(emptyProps as any)} />
    }

    const successProps = {
      ...afterQueryData,
      ...userProps,
      queryResult: queryResultWithNetworkStatus,
    }

    return <Success {...(successProps as any)} />
  }

  SuspendingSuccess.displayName = displayName

  // @NOTE: Note that we are returning a HoC here!
  return (props: CellProps) => {
    /**
     * Right now, Cells don't render `children`.
     */
    const { children: _, ...variables } = props
    const options = beforeQuery(variables)

    // `beforeQuery` can keep the query from running, either by returning
    // Apollo's `skipToken` (recommended) or by setting the `skip` option.
    // `skipToken` is a symbol rather than an options object, so everything that
    // reads individual options has to go through `queryOptions`.
    // We check for a symbol instead of comparing against `skipToken` itself
    // because Apollo Client deliberately leaves `skipToken` out of its
    // react-server build, where importing it is a bundling error
    const queryOptions = typeof options === 'symbol' ? undefined : options
    const skipped = !queryOptions || queryOptions.skip === true

    // While skipped the document is never executed, it just has to exist to
    // satisfy the query hook
    const query =
      typeof cellQuery === 'function'
        ? cellQuery(queryOptions ?? {})
        : cellQuery
    // `beforeQuery`'s options are typed against `useQuery`, which accepts a
    // slightly wider `fetchPolicy` than `useBackgroundQuery` does. Streaming
    // Cells that set one of the extra policies aren't supported
    const backgroundQueryOptions = options as
      SkipToken | useBackgroundQuery.Options<OperationVariables>

    // The query document is untyped, so Apollo Client would infer `unknown` for
    // the data. Cells treat query results as `DataObject`s, same as `useQuery`
    // is called in createCell
    const [queryRef, other] = useBackgroundQuery<DataObject>(
      query,
      backgroundQueryOptions,
    )

    const client = useApolloClient()

    // Like the non-suspending Cell, a skipped Cell renders nothing.
    //
    // `queryRef` is undefined while the query has never run, and passing that
    // to `useReadQuery` throws. But once the query has run even once, Apollo
    // Client keeps handing back the previous `queryRef` even if the Cell is
    // skipped again later, so a Cell going from active to skipped would keep
    // rendering stale data. That's why this checks `skipped` – derived from
    // what `beforeQuery` returned – and not just the query reference
    if (skipped || !queryRef) {
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

      // `Failure` is checked against this Cell's real `CellVariables` at its
      // own call site. Inside this generic factory function that's still
      // abstract, so the props object is asserted here rather than checked
      // (see the same pattern, with more detail, in createCell.tsx)
      const failureProps = {
        error,
        errorCode: CombinedGraphQLErrors.is(error)
          ? (error.errors[0]?.extensions?.['code'] as string)
          : undefined,
        queryResult: queryResultWithErrorReset,
      }

      return <Failure {...(failureProps as any)} />
    }

    const wrapInSuspenseIfLoadingPresent = (
      suspendingSuccessElement: React.ReactNode,
      LoadingComponent: typeof Loading,
    ) => {
      if (!LoadingComponent) {
        return suspendingSuccessElement
      }

      // `Loading` is checked against this Cell's real `CellVariables` at its
      // own call site. Inside this generic factory function that's still
      // abstract, so the props object is asserted here rather than checked
      // (see the same pattern, with more detail, in createCell.tsx)
      const loadingProps = { ...props, queryResult: suspenseQueryResult }

      return (
        <Suspense fallback={<LoadingComponent {...(loadingProps as any)} />}>
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
