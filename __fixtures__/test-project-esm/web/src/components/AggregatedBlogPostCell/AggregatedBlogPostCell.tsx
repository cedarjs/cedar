import type {
  FindAggregatedBlogPostQuery,
  FindAggregatedBlogPostQueryVariables,
} from 'types/graphql'

import type {
  CellSuccessProps,
  CellFailureProps,
  TypedDocumentNode,
} from '@cedarjs/web'

import AuthorFragmentCell from 'src/components/AuthorFragmentCell'

// The `...AuthorFragmentCell_author` spread pulls in the data requirements
// that AuthorFragmentCell declares with its FRAGMENT export. The fragment
// definition itself is automatically registered with the GraphQL client, so
// everything is fetched in a single request – no request waterfall like the
// one WaterfallBlogPostCell creates
export const QUERY: TypedDocumentNode<
  FindAggregatedBlogPostQuery,
  FindAggregatedBlogPostQueryVariables
> = gql`
  query FindAggregatedBlogPostQuery($id: Int!) {
    aggregatedBlogPost: post(id: $id) {
      id
      title
      body
      createdAt
      author {
        ...AuthorFragmentCell_author
      }
    }
  }
`

export const Loading = () => <div>Loading...</div>

export const Empty = () => <div>Empty</div>

export const Failure = ({
  error,
}: CellFailureProps<FindAggregatedBlogPostQueryVariables>) => (
  <div style={{ color: 'red' }}>Error: {error?.message}</div>
)

export const Success = ({
  aggregatedBlogPost,
}: CellSuccessProps<
  FindAggregatedBlogPostQuery,
  FindAggregatedBlogPostQueryVariables
>) => (
  <article className="aggregated-blog-post">
    {aggregatedBlogPost && (
      <>
        <header className="mt-4">
          <p className="text-sm">
            {new Intl.DateTimeFormat('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            }).format(new Date(aggregatedBlogPost.createdAt))}{' '}
            - By: <AuthorFragmentCell author={aggregatedBlogPost.author} />
          </p>
          <h2 className="mt-2 text-xl font-semibold">
            {aggregatedBlogPost.title}
          </h2>
        </header>
        <div className="mb-4 mt-2 font-light text-gray-900">
          {aggregatedBlogPost.body}
        </div>
      </>
    )}
  </article>
)
