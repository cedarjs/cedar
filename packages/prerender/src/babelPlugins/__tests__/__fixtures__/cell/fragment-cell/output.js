import { createCell } from '@cedarjs/web'
export const FRAGMENT = gql`
  fragment FragmentCell_author on User {
    email
    fullName
  }
`
export const Success = ({ author }) => {
  return JSON.stringify(author, null, 2)
}
export default createCell({
  FRAGMENT,
  Success,
  displayName: 'code',
})