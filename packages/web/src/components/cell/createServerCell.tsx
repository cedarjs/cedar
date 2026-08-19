/// <reference types="react/experimental" />

import React, { Suspense } from 'react'

import type { OperationVariables } from '@apollo/client'

// Class components are not supported on the server
// https://nextjs.org/docs/app/building-your-application/rendering/composition-patterns#when-to-use-server-and-client-components
// Consider https://github.com/bvaughn/react-error-boundary
// import { CellErrorBoundary } from './CellErrorBoundary.js'
import type { CreateCellProps } from './cellTypes.js'
import { isDataEmpty } from './isCellEmpty.js'

// TODO(RSC): Clean this type up and consider moving to cellTypes
type CreateServerCellProps<
  CellProps,
  CellVariables extends OperationVariables = OperationVariables,
  GQLResult = any,
> = Omit<
  CreateCellProps<CellProps, CellVariables, GQLResult>,
  'QUERY' | 'Failure'
> & {
  data: (variables?: AnyObj) => any
  Failure?: React.ComponentType<{
    error: unknown
    queryResult: { refetch: (variables: CellProps) => AnyObj }
  }>
}

type AnyObj = Record<string, unknown>

export function createServerCell<
  CellProps extends AnyObj,
  CellVariables extends OperationVariables = OperationVariables,
  GQLResult = any,
>(
  createCellProps: CreateServerCellProps<CellProps, CellVariables, GQLResult>, // 👈 AnyObj, because using CellProps causes a TS error
): React.FC<CellProps> {
  const {
    data: dataFn,
    isEmpty = isDataEmpty,
    Loading,
    Failure,
    Empty,
    Success,
    displayName = 'Cell',
  } = createCellProps
  async function SuspendingSuccess(props: CellProps) {
    // Right now, Cells don't render `children`
    const { children: _, ...variables } = props

    const FailureComponent = ({ error }: { error: unknown }) => {
      if (!Failure) {
        // So that it bubbles up to the nearest error boundary
        throw error
      }

      const queryResultWithRefetch = {
        refetch: (variables: CellProps | undefined) => {
          // TODO (RSC): How do we refresh the page with new data?
          return dataFn(variables)
        },
      }

      return <Failure error={error} queryResult={queryResultWithRefetch} />
    }

    try {
      const data = await dataFn(variables)

      // `data` comes from `dataFn`, which is untyped (`(variables?: AnyObj) =>
      // any`), so the merged props below are already `any` -- no assertion
      // needed to pass them to `Empty`/`Success`, which are checked against
      // this Cell's real `GQLResult`/`CellVariables` at its own call site
      if (isEmpty(data, { isDataEmpty }) && Empty) {
        const emptyProps = { ...props, ...data }

        return <Empty {...emptyProps} />
      }

      const successProps = { ...data, ...props }

      return <Success {...successProps} />
    } catch (error) {
      return <FailureComponent error={error} />
    }
  }

  SuspendingSuccess.displayName = displayName

  // @NOTE: We are returning a HoC here!
  return (props: CellProps) => {
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
      return (
        <Suspense fallback={<LoadingComponent {...(props as any)} />}>
          {suspendingSuccessElement}
        </Suspense>
      )
    }

    return (
      // TODO(RSC): Do we always want a client side error boundary? If so, this
      // is where we'd add it
      // <CellErrorBoundary renderFallback={FailureComponent}>
      <>
        {wrapInSuspenseIfLoadingPresent(
          <SuspendingSuccess {...props} />,
          Loading,
        )}
      </>
      // </CellErrorBoundary>
    )
  }
}
