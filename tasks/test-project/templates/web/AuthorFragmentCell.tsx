import Author from 'src/components/Author'

// TODO(fragment-underscore): When the underscore rule is removed, rename this
// fragment to `AuthorFragmentCellFragmentAuthor` so the Cell keeps its
// `author` prop. Also update the spread in AggregatedBlogPostCell and the
// fragment name check in tasks/smoke-tests/shared/aggregatedCells.ts
export const FRAGMENT = gql`
  fragment AuthorFragmentCell_author on User {
    id
    email
    fullName
  }
`

interface SuccessProps {
  author: {
    id: string
    email: string
    fullName: string
  }
}

export const Success = ({ author }: SuccessProps) => (
  <span className="author-fragment-cell">
    <Author author={author} />
  </span>
)
