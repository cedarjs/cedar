import { useLiveQuery } from '@cedarjs/gqlorm/react/useLiveQuery'

interface Post {
  id: number
  title: string
  body: string
  author: {
    email: string
    fullName: string
  }
  createdAt: string
}

const LivePosts = () => {
  const { data, loading, error } = useLiveQuery<Post[]>((db) =>
    db.post.findMany()
  )

  if (loading) {
    return <div>Loading...</div>
  }

  if (error) {
    return <div style={{ color: 'red' }}>Error: {error.message}</div>
  }

  if (!data || data.length === 0) {
    return <div>No posts yet</div>
  }

  return (
    <div className="divide-grey-700 divide-y">
      {data.map((post) => (
        <article key={post.id} className="py-4">
          <header>
            <h2 className="text-xl font-semibold">{post.title}</h2>
          </header>
          <div className="mt-2 font-light text-gray-900">{post.body}</div>
        </article>
      ))}
    </div>
  )
}

export default LivePosts
