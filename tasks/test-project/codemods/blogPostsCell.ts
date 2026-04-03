const query = `
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

const successComponent = `export const Success = ({
  blogPosts,
}: CellSuccessProps<BlogPostsQuery, BlogPostsQueryVariables>) => (
  <div className="divide-grey-700 divide-y">
    {blogPosts.map((post) => (
      <BlogPost key={post.id} blogPost={post} />
    ))}
  </div>
)\n`

export function applyBlogPostsCellCodemod(source: string) {
  // Add BlogPost import after the @cedarjs/web import block
  let newSource = source.replace(
    "} from '@cedarjs/web'\n",
    "} from '@cedarjs/web'\n\nimport BlogPost from 'src/components/BlogPost'\n",
  )

  // Replace QUERY content
  newSource = newSource.replace(
    /gql`\s*query BlogPostsQuery \{[\s\S]*?\}\s*`/,
    `gql\`${query}\``,
  )

  // Replace entire Success component
  newSource = newSource.replace(
    /export const Success =[\s\S]*/,
    successComponent,
  )

  return newSource
}
