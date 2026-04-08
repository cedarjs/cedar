import { render } from '@cedarjs/testing/web'

import BlogLayout from './BlogLayout'

//   Improve this test with help from the CedarJS Testing Doc:
//   https://cedarjs.com/docs/testing#testing-pages-layouts

describe('BlogLayout', () => {
  it('renders successfully', () => {
    expect(() => {
      render(<BlogLayout />)
    }).not.toThrow()
  })
})
