// These are normally auto-imported by babel
import React from 'react'

import { skipToken } from '@apollo/client/react'
import { gql } from 'graphql-tag'
import { describe, expect, test } from 'tstyche'

import { createCell } from '@cedarjs/web'
import type {
  CellFailureProps,
  CellLoadingProps,
  CellProps,
  CellSuccessProps,
  TypedDocumentNode,
} from '@cedarjs/web'

type ExampleQueryVariables = {
  category: string
  saved: boolean
}

// Just an example model returned from the query
type Recipe = {
  __typename?: 'Recipe'
  id: string
  name: string
}

// This is the type returned by querying
// e.g. query ListRecipes { recipes { id name } }
type QueryResult = {
  __typename?: 'Query'
  recipes: Recipe[]
}

// This is how graphql-codegen defines queries that don't take vars
type EmptyVariables = { [key: string]: never }

// This Cell takes a customProp i.e. one not provided by the Cell's query
interface SuccessProps extends CellSuccessProps<QueryResult> {
  customProp: number
}

const recipeCell = {
  QUERY: gql`
    query ListRecipes {
      recipes {
        id
        name
      }
    }
  `,
  Loading: () => null,
  Empty: () => null,
  Failure: () => null,
  Success: (props: SuccessProps) => {
    return (
      <>
        <h1>Example Component</h1>
        <ul>
          <li>Recipe prop {props.recipes.length} </li>
          <li>Custom prop {props.customProp}</li>
        </ul>
      </>
    )
  },
}

// Like real generated Cells, this fixture's Success is annotated with both
// the query result and the query variables. (`recipeCell` above leaves
// `TVariables` at its default.)
interface SuccessWithVariablesProps extends CellSuccessProps<
  QueryResult,
  ExampleQueryVariables
> {
  customProp: number
}

const recipeCellWithVariables = {
  ...recipeCell,
  Success: (props: SuccessWithVariablesProps) => {
    return <h1>{props.recipes.length}</h1>
  },
}

describe('CellProps mapper type', () => {
  describe('when beforeQuery does not exist', () => {
    test('Inputs expect props outside cell', () => {
      type CellInputs = CellProps<
        typeof recipeCell.Success,
        QueryResult,
        typeof recipeCell,
        ExampleQueryVariables
      >

      expect<CellInputs>().type.toBeAssignableFrom({
        customProp: 55,
        category: 'Dinner',
        saved: true,
      })
    })

    test('Inputs still expect custom props when query does not take variables', () => {
      type CellWithoutVariablesInputs = CellProps<
        typeof recipeCell.Success,
        QueryResult,
        typeof recipeCell,
        EmptyVariables
      >

      expect<CellWithoutVariablesInputs>().type.toBeAssignableFrom({
        customProp: 55,
      })
    })
  })

  describe('when beforeQuery exists and has arguments', () => {
    test('Inputs expect props outside cell', () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const cellWithBeforeQuery = {
        ...recipeCell,
        beforeQuery: ({ word }: { word: string }) => {
          return {
            variables: {
              category: word,
              saved: !!word,
            },
          }
        },
      }

      type CellWithBeforeQueryInputs = CellProps<
        typeof cellWithBeforeQuery.Success,
        QueryResult,
        typeof cellWithBeforeQuery,
        ExampleQueryVariables
      >

      // Note that the gql variables are no longer required here
      expect<CellWithBeforeQueryInputs>().type.toBeAssignableFrom({
        word: 'abracadabra',
        customProp: 99,
      })
    })

    test('Inputs reject beforeQuery args that are missing or of the wrong type', () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const cellWithBeforeQuery = {
        ...recipeCellWithVariables,
        beforeQuery: ({ word }: { word: string }) => {
          return {
            variables: {
              category: word,
              saved: !!word,
            },
          }
        },
      }

      type CellWithBeforeQueryInputs = CellProps<
        typeof cellWithBeforeQuery.Success,
        QueryResult,
        typeof cellWithBeforeQuery,
        ExampleQueryVariables
      >

      // `word` is missing
      expect<CellWithBeforeQueryInputs>().type.not.toBeAssignableFrom({
        customProp: 99,
      })

      // `word` has the wrong type
      expect<CellWithBeforeQueryInputs>().type.not.toBeAssignableFrom({
        word: 42,
        customProp: 99,
      })

      // `customProp` is missing
      expect<CellWithBeforeQueryInputs>().type.not.toBeAssignableFrom({
        word: 'abracadabra',
      })
    })

    test('Inputs do not require the query variables when beforeQuery computes them', () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const cellWithBeforeQuery = {
        ...recipeCellWithVariables,
        beforeQuery: ({ word }: { word: string }) => {
          return {
            variables: {
              category: word,
              saved: !!word,
            },
          }
        },
      }

      type CellWithBeforeQueryInputs = CellProps<
        typeof cellWithBeforeQuery.Success,
        QueryResult,
        typeof cellWithBeforeQuery,
        ExampleQueryVariables
      >

      // Even though `Success` is annotated with the query's variables
      // (`category` and `saved`), the Cell's caller only provides `word`
      expect<CellWithBeforeQueryInputs>().type.toBeAssignableFrom({
        word: 'abracadabra',
        customProp: 99,
      })
    })

    test('Inputs still expect custom props when query does not take variables', () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const cellWithBeforeQuery = {
        ...recipeCell,
        beforeQuery: ({ fetchPolicy }: { fetchPolicy: string }) => {
          return {
            fetchPolicy,
          }
        },
      }

      type CellWithBeforeQueryInputs = CellProps<
        typeof cellWithBeforeQuery.Success,
        QueryResult,
        typeof cellWithBeforeQuery,
        EmptyVariables
      >

      expect<CellWithBeforeQueryInputs>().type.toBeAssignableFrom({
        fetchPolicy: 'cache-only',
        customProp: 55,
      })
    })
  })

  describe('when beforeQuery exists and has no arguments', () => {
    test('Inputs expect props outside cell', () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const cellWithBeforeQuery = {
        ...recipeCell,
        beforeQuery: () => {
          return {
            variables: {
              category: 'Dinner',
              saved: true,
            },
          }
        },
      }

      type CellWithBeforeQueryInputs = CellProps<
        typeof cellWithBeforeQuery.Success,
        QueryResult,
        typeof cellWithBeforeQuery,
        ExampleQueryVariables
      >

      // Note that the gql variables are no longer required here
      expect<CellWithBeforeQueryInputs>().type.toBeAssignableFrom({
        customProp: 99,
      })

      // A zero-arg beforeQuery accepts any props, including none at all
      expect<CellWithBeforeQueryInputs>().type.toBeAssignableFrom({})
      expect<CellWithBeforeQueryInputs>().type.toBeAssignableFrom({
        anything: 'goes',
      })
    })

    test('Inputs still expect custom props when query does not take variables', () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const cellWithBeforeQuery = {
        ...recipeCell,
        beforeQuery: () => {
          return {
            fetchPolicy: 'cache-only',
          }
        },
      }

      type CellWithBeforeQueryInputs = CellProps<
        typeof cellWithBeforeQuery.Success,
        QueryResult,
        typeof cellWithBeforeQuery,
        EmptyVariables
      >

      expect<CellWithBeforeQueryInputs>().type.toBeAssignableFrom({
        customProp: 55,
      })
    })
  })

  describe('what beforeQuery is allowed to return', () => {
    // These tests are only about the shape `beforeQuery` is allowed to
    // return, so `Success` is deliberately left at the bare `CellSuccessProps`
    // type here, rather than reusing `recipeCell.Success`. `recipeCell.Success`
    // requires a `customProp` that isn't part of these tests' `beforeQuery`
    // props (just `{ word: string }`), which is an unrelated mismatch to what
    // these tests are checking, not something #2366 fixed.
    const recipeCellForBeforeQuery = {
      ...recipeCell,
      Success: (_props: CellSuccessProps) => null,
    }

    test('Just variables', () => {
      expect(
        createCell({
          ...recipeCellForBeforeQuery,
          beforeQuery: ({ word }: { word: string }) => ({
            variables: { category: word, saved: true },
          }),
        }),
      ).type.not.toRaiseError()
    })

    test('Other query hook options alongside the variables', () => {
      expect(
        createCell({
          ...recipeCellForBeforeQuery,
          beforeQuery: ({ word }: { word: string }) => ({
            variables: { category: word, saved: true },
            fetchPolicy: 'cache-only' as const,
            skip: !word,
          }),
        }),
      ).type.not.toRaiseError()
    })

    test('skipToken, to not run the query at all', () => {
      expect(
        createCell({
          ...recipeCellForBeforeQuery,
          beforeQuery: ({ word }: { word: string }) =>
            word ? { variables: { category: word, saved: true } } : skipToken,
        }),
      ).type.not.toRaiseError()
    })
  })

  describe('InputVarProps does not degrade to any when TVariables is defaulted', () => {
    // Regression test for https://github.com/cedarjs/cedar/issues/2353
    //
    // TVariables defaults to `any` on CellSuccessProps/CellFailureProps/
    // CellLoadingProps. If InputVarProps doesn't guard against that, the
    // conditional distributes over `any` and resolves to `any`, which
    // poisons the whole intersected props type (`X & any` = `any`) --
    // silently disabling all prop checking.
    //
    // Note this can't be caught by redeclaring a custom prop on an
    // `interface ... extends ...`, since TypeScript keeps an interface's own
    // explicitly-typed members even when the type it extends is poisoned to
    // `any`. Instead, these tests lean on excess property checks: TypeScript
    // only flags unknown properties on an object literal when it's checked
    // against a real object type, not against `any`, so a bogus property is
    // a reliable way to tell "properly typed" apart from "poisoned to any".

    test('CellSuccessProps<TData> (single-arg form) rejects unknown properties', () => {
      expect<CellSuccessProps<QueryResult>>().type.not.toBeAssignableFrom({
        recipes: [],
        bogusProp: 'should not be allowed',
      })
    })

    test('CellSuccessProps<TData, TVariables> (two-arg form) rejects unknown properties', () => {
      expect<
        CellSuccessProps<QueryResult, ExampleQueryVariables>
      >().type.not.toBeAssignableFrom({
        recipes: [],
        category: 'Dinner',
        saved: true,
        bogusProp: 'should not be allowed',
      })
    })

    test('CellFailureProps (no-arg form) rejects unknown properties', () => {
      expect<CellFailureProps>().type.not.toBeAssignableFrom({
        bogusProp: 'should not be allowed',
      })
    })

    test('CellLoadingProps (no-arg form) rejects unknown properties', () => {
      expect<CellLoadingProps>().type.not.toBeAssignableFrom({
        bogusProp: 'should not be allowed',
      })
    })
  })

  describe('createCell checks Success/Empty/Failure/Loading against the real QUERY type', () => {
    // Regression test for https://github.com/cedarjs/cedar/issues/2366
    //
    // Real, CLI-generated Cells type QUERY with TypedDocumentNode<TData,
    // TVariables> and type Success/Failure/Loading with CellSuccessProps<
    // TData, TVariables> etc, exactly like this fixture does. Before #2366,
    // CreateCellProps checked those components against the bare, defaulted-
    // to-`any` CellSuccessProps/CellFailureProps/CellLoadingProps instead of
    // this Cell's own QUERY type, so a Success reading a field that doesn't
    // exist on the query result went uncaught.
    const typedQuery = gql`
      query ListRecipes {
        recipes {
          id
          name
        }
      }
    ` as TypedDocumentNode<QueryResult, EmptyVariables>

    test('Success typed against the real query result is fine', () => {
      expect(
        createCell({
          QUERY: typedQuery,
          Success: (props: CellSuccessProps<QueryResult>) => (
            <ul>{props.recipes.length}</ul>
          ),
        }),
      ).type.not.toRaiseError()
    })

    // Mirrors the `SuccessProps`/`customProp` fixture near the top of this
    // file, but requires a prop the query result doesn't provide -- before
    // #2366, this went unnoticed because `Success` was checked against the
    // bare, defaulted-to-`any` `CellSuccessProps`, not against this Cell's
    // own `QUERY` type
    interface MismatchedSuccessProps extends CellSuccessProps<QueryResult> {
      totallyWrongProp: number
    }

    test('Success requiring a prop the query result does not provide raises an error', () => {
      expect(
        createCell({
          QUERY: typedQuery,
          Success: (props: MismatchedSuccessProps) => (
            <p>{props.totallyWrongProp}</p>
          ),
        }),
      ).type.toRaiseError()
    })
  })
})
