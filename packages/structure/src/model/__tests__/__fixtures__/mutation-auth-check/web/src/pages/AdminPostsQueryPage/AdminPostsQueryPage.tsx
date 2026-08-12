import { useQuery } from '@cedarjs/web'

const POSTS_QUERY = gql`
  query PostsQuery {
    posts {
      id
      title
    }
  }
`

const AdminPostsQueryPage = () => {
  const { data } = useQuery(POSTS_QUERY)

  return <div>{data?.posts?.length ?? 0}</div>
}

export default AdminPostsQueryPage
