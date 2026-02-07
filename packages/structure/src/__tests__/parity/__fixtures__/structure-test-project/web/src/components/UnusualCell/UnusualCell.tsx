export const QUERY = gql`
  query UnusualCell($id: Int!) {
    post(id: $id) {
      id
      title
    }
  }
`

export const Loading = () => <div>Loading...</div>

// Unusual Success export
const MySuccess = ({ post }) => <div>{post.title}</div>
export { MySuccess as Success }

export const Failure = ({ error }) => <div>{error.message}</div>
