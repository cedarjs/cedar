import React from 'react'

import { ApolloClient, ApolloLink, InMemoryCache, gql } from '@apollo/client'
import { ApolloProvider } from '@apollo/client/react'
import { render, screen } from '@testing-library/react'
import { describe, test } from 'vitest'

import { fragmentRegistry, registerFragment } from './fragmentRegistry.js'

const { useRegisteredFragment: useStallFragment } = registerFragment(gql`
  fragment Stall_info on Stall {
    id
    name
  }
`)

const { useRegisteredFragment: useFruitFragment } = registerFragment(gql`
  fragment Fruit_info on Fruit {
    id
    name
    isSeedless
    stall {
      ...Stall_info
    }
  }
`)

const StallInfo = ({ id }: { id: string }) => {
  const { data: stall, complete } = useStallFragment<any>(id)

  return complete ? <p>Stall Name: {stall.name}</p> : <p>stall incomplete</p>
}

const FruitInfo = ({ id }: { id: string }) => {
  const { data: fruit, complete } = useFruitFragment<any>(id)

  return complete ? (
    <div>
      <h2>Fruit Name: {fruit.name}</h2>
      <StallInfo id={fruit.stall.id} />
    </div>
  ) : (
    <div>fruit incomplete</div>
  )
}

describe('registered fragments with nested spreads', () => {
  test('reads complete data back from the cache', async () => {
    const cache = new InMemoryCache({ fragments: fragmentRegistry })

    const client = new ApolloClient({ cache, link: ApolloLink.empty() })

    // Mimic what a parent Cell's query would write into the cache
    client.writeQuery({
      query: gql`
        query GetGroceries {
          groceries {
            ... on Fruit {
              ...Fruit_info
            }
          }
        }
      `,
      data: {
        groceries: [
          {
            __typename: 'Fruit',
            id: '1',
            name: 'Strawberries',
            isSeedless: false,
            stall: {
              __typename: 'Stall',
              id: 's1',
              name: 'Pie Veggies',
            },
          },
        ],
      },
    })

    render(
      <ApolloProvider client={client}>
        <FruitInfo id="1" />
      </ApolloProvider>,
    )

    screen.getByText('Fruit Name: Strawberries')
    screen.getByText('Stall Name: Pie Veggies')
  })
})
