import { render } from '@cedarjs/testing/web'

import AggregatedBlogPostPage from './AggregatedBlogPostPage'

//   Improve this test with help from the CedarJS Testing Doc:
//   https://cedarjs.com/docs/testing#testing-pages-layouts

describe('AggregatedBlogPostPage', () => {
  it('renders successfully', () => {
    expect(() => {
      render(<AggregatedBlogPostPage id={42} />)
    }).not.toThrow()
  })
})
