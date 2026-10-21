import { gql } from 'graphql-tag'

import type { CellSuccessProps, TypedDocumentNode } from '@cedarjs/web'

type UserQuery = { user: { id: number; name: string } }
type UserVariables = { id: number }

declare function graphql(
  source: string,
  fragments: unknown[],
): TypedDocumentNode<UserQuery, UserVariables>

export const QUERY = graphql(
  `query UserQuery($id: Int!) { user(id: $id) { id name } }`,
  [],
)

export const FRAGMENT = gql`
  fragment UserDetails on User {
    id
    name
  }
`

export const Success = ({ user }: CellSuccessProps<UserQuery, UserVariables>) => (
  <div>{user.name}</div>
)
