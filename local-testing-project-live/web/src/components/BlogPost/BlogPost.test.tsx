import { render } from '@cedarjs/testing/web'

import BlogPost from './BlogPost'

//   Improve this test with help from the CedarJS Testing Doc:
//    https://cedarjs.com/docs/testing#testing-components

describe('BlogPost', () => {
  it('renders successfully', () => {
    expect(() => {
      render(<BlogPost />)
    }).not.toThrow()
  })
})
