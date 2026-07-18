export const FRAGMENT = gql`
  fragment TodoStatusCell_todo on Todo {
    id
    status
  }
`

export const Success = ({ todo }) => {
  return <span>{todo.status}</span>
}
