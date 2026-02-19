/**
 * React hook for live data fetching using GraphQL queries with `@live`
 * generated from Prisma-like query functions.
 */

import { useMemo } from 'react'

import { parse } from 'graphql'

import { useQuery as cedarUseQuery } from '@cedarjs/web'

import { queryBuilder } from '../queryBuilder.js'
import type { QueryFunction } from '../types/orm.js'

type QueryVariables = Record<string, unknown>
type QueryPayload<T> = Record<string, T>

export type UseLiveQueryOptions = Omit<
  NonNullable<Parameters<typeof cedarUseQuery>[1]>,
  'variables'
>

export type UseLiveQueryResult<T> = Omit<
  ReturnType<typeof cedarUseQuery>,
  'data'
> & {
  data: T | undefined
}

function extractRootFieldData<T>(
  payload: QueryPayload<T> | undefined,
): T | undefined {
  if (!payload) {
    return undefined
  }

  return Object.values(payload)[0] as T | undefined
}

export function useLiveQuery<T>(
  queryFn: QueryFunction<T>,
  options?: UseLiveQueryOptions,
): UseLiveQueryResult<T> {
  const { query, variables } = useMemo(() => {
    try {
      const graphqlQuery = queryBuilder.buildFromFunction(queryFn, {
        isLive: true,
      })

      return {
        query: graphqlQuery.query,
        variables: graphqlQuery.variables ?? {},
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to build GraphQL query: ${errorMsg}`)
    }
  }, [queryFn])

  const document = useMemo(() => parse(query), [query])

  const queryResult = cedarUseQuery<QueryPayload<T>, QueryVariables>(document, {
    ...(options ?? {}),
    variables,
  })

  return {
    ...queryResult,
    data: extractRootFieldData(queryResult.data),
  }
}
