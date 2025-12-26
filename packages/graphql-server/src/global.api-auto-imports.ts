import type _gql from 'graphql-tag'

type Gql = typeof _gql

declare global {
  const gql: Gql['gql'] extends undefined ? Gql : Gql['gql']
}
