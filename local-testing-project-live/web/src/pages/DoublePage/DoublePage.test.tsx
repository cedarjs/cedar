import { render } from '@cedarjs/testing/web'

import DoublePage from './DoublePage'

//   Improve this test with help from the CedarJS Testing Doc:
//   https://cedarjs.com/docs/testing#testing-pages-layouts

describe('DoublePage', () => {
  it('renders successfully', () => {
    expect(() => {
      render(<DoublePage />)
    }).not.toThrow()
  })
})
