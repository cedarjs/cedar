const query = `
    query FindBlogPostQuery($id: Int!) {
      blogPost: post(id: $id) {
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
  blogPost,
}: CellSuccessProps<FindBlogPostQuery, FindBlogPostQueryVariables>) => (
  <BlogPost blogPost={blogPost} />
)\n`

export function applyBlogPostCellCodemod(source: string, live = false) {
  // Add BlogPost import after the @cedarjs/web import block
  let newSource = source.replace(
    "} from '@cedarjs/web'\n",
    "} from '@cedarjs/web'\n\nimport BlogPost from 'src/components/BlogPost'\n",
  )

  // Replace QUERY content
  let queryStr = `gql\`${query}\``
  if (live) {
    queryStr = queryStr.replace(
      'query FindBlogPostQuery($id: Int!) {',
      'query FindBlogPostQuery($id: Int!) @live {',
    )
  }
  newSource = newSource.replace(
    /gql`\s*query FindBlogPostQuery[\s\S]*?`/,
    queryStr,
  )

  // Replace entire Success component
  newSource = newSource.replace(
    /export const Success =[\s\S]*/,
    successComponent,
  )

  return newSource
}
