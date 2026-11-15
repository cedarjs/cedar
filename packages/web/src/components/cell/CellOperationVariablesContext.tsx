import React, { createContext, useContext } from 'react'

import type { OperationVariables } from '@apollo/client'
import type { DocumentNode, OperationDefinitionNode } from 'graphql'
import { Kind, valueFromASTUntyped } from 'graphql'

/**
 * Holds the variables of the GraphQL operation (query) that fetched the data
 * rendered below it.
 *
 * Only Cells that run a query provide a value. Fragment Cells read it and use
 * it to read their fragment from the GraphQL client's cache, so that fields
 * with arguments that reference operation variables (like
 * `comments(first: $count)`) resolve to the same cache entries the query
 * wrote. Fragment Cells never provide a value of their own, so nested
 * fragment Cells see the variables of the nearest query Cell above them.
 *
 * GraphQL operation variables are global to the whole document, which is why
 * passing them on unchanged to every fragment spread inside the query is
 * correct.
 */
const CellOperationVariablesContext = createContext<
  OperationVariables | undefined
>(undefined)

interface ProviderProps {
  variables: OperationVariables | undefined
  children?: React.ReactNode
}

export const CellOperationVariablesProvider = ({
  variables,
  children,
}: ProviderProps) => {
  return (
    <CellOperationVariablesContext.Provider value={variables}>
      {children}
    </CellOperationVariablesContext.Provider>
  )
}

/**
 * The variables of the nearest query Cell's operation, or `undefined` when
 * not rendered inside a query Cell.
 */
export function useCellOperationVariables() {
  return useContext(CellOperationVariablesContext)
}

/**
 * Applies the default values declared in the operation's variable
 * definitions (`query Q($count: Int = 10)`) to `variables`, the same way
 * Apollo Client does before running a query and writing its result to the
 * cache. A variable that is missing or `undefined` gets its default value.
 */
export function withOperationVariableDefaults(
  query: DocumentNode,
  variables: OperationVariables | undefined,
): OperationVariables {
  const operation = query.definitions.find(
    (definition): definition is OperationDefinitionNode =>
      definition.kind === Kind.OPERATION_DEFINITION,
  )

  const defaults: OperationVariables = {}

  for (const variableDefinition of operation?.variableDefinitions ?? []) {
    if (variableDefinition.defaultValue) {
      defaults[variableDefinition.variable.name.value] = valueFromASTUntyped(
        variableDefinition.defaultValue,
      )
    }
  }

  const result: OperationVariables = { ...defaults }

  for (const [name, value] of Object.entries(variables ?? {})) {
    if (value !== undefined || !(name in defaults)) {
      result[name] = value
    }
  }

  return result
}
