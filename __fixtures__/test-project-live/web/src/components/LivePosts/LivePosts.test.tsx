import { render } from '@cedarjs/testing/web'

import LivePosts from './LivePosts'

//   Improve this test with help from the CedarJS Testing Doc:
//    https://cedarjs.com/docs/testing#testing-components

describe('LivePosts', () => {
  it('renders successfully', () => {
    expect(() => {
      render(<LivePosts />)
    }).not.toThrow()
  })
})
