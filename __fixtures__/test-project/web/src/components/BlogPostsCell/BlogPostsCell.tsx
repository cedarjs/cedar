import type { TypedDocumentNode } from '@graphql-typed-document-node/core'
import type { BlogPostsQuery, BlogPostsQueryVariables } from 'types/graphql'

import type { CellFailureProps, CellSuccessProps } from '@cedarjs/web'

import BlogPost from 'src/components/BlogPost'

export const QUERY: TypedDocumentNode<BlogPostsQuery, BlogPostsQueryVariables> =
  gql`
    query BlogPostsQuery {
      blogPosts: posts {
        id
        title
        body
        author {
          email
          fullName
        }
        createdAt
      }
    }
  `

export const Loading = () => <div>Loading...</div>

export const Empty = () => <div>Empty</div>

export const Failure = ({
  error,
}: CellFailureProps<BlogPostsQueryVariables>) => (
  <div style={{ color: 'red' }}>Error: {error?.message}</div>
)

export const Success = ({
  blogPosts,
}: CellSuccessProps<BlogPostsQuery, BlogPostsQueryVariables>) => {
  return (
    <div className="divide-grey-700 divide-y">
      {blogPosts.map((post) => (
        <BlogPost key={post.id} blogPost={post} />
      ))}
    </div>
  )
}
