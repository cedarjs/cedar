import { useMutation } from '@cedarjs/web'

const DELETE_POST_MUTATION = gql`
  mutation DeletePostMutation($id: Int!) {
    deletePost(id: $id) {
      id
    }
  }
`

const DeletePostButton = () => {
  const [deletePost] = useMutation(DELETE_POST_MUTATION)

  return (
    <button onClick={() => deletePost({ variables: { id: 1 } })}>
      Delete
    </button>
  )
}

export default DeletePostButton
