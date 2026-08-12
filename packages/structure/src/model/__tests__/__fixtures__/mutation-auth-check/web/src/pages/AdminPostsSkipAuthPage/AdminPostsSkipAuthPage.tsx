import { useMutation } from '@cedarjs/web'

const ARCHIVE_POST_MUTATION = gql`
  mutation ArchivePostMutation($id: Int!) {
    archivePost(id: $id)
  }
`

const AdminPostsSkipAuthPage = () => {
  const [archivePost] = useMutation(ARCHIVE_POST_MUTATION)

  return (
    <button onClick={() => archivePost({ variables: { id: 1 } })}>
      Archive
    </button>
  )
}

export default AdminPostsSkipAuthPage
