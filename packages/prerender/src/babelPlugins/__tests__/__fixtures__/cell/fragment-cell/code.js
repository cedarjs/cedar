export const FRAGMENT = gql`
  fragment FragmentCell_author on User {
    email
    fullName
  }
`

export const Success = ({ author }) => {
  return JSON.stringify(author, null, 2)
}
