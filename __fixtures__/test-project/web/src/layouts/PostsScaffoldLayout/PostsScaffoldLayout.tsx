import type { WrapperProps } from '@cedarjs/router'

import ScaffoldLayout from 'src/layouts/ScaffoldLayout'

function PostsScaffoldLayout({ children }: WrapperProps) {
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
