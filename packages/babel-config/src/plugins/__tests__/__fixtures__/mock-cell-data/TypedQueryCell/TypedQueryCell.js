export const QUERY = graphql(
  `query FindUserById($id: Int!) { user(id: $id) { id } }`,
  [graphql(`fragment UserFields on User { id }`)],
)

const anotherDocument = graphql(`query IgnoreMe { users { id } }`)

function nestedQuery() {
  const QUERY = graphql(`query NestedDecoy { users { id } }`)
  return QUERY
}

export const Loading = () => <div>Loading...</div>
export const Success = ({ user }) => <div>{user.id}</div>
