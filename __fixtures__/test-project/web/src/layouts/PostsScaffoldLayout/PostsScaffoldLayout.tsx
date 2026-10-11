import ScaffoldLayout from 'src/layouts/ScaffoldLayout'

type PostsScaffoldLayoutProps = {
  children: React.ReactNode
}

const PostsScaffoldLayout = ({ children }: PostsScaffoldLayoutProps) => {
  return (
    <ScaffoldLayout
      title="Posts"
      titleTo="posts"
      buttonLabel="New Post"
      buttonTo="newPost"
    >
      {children}
    </ScaffoldLayout>
  )
}

export default PostsScaffoldLayout
