import { render } from '@cedarjs/testing/web'

import TestLayout from './TestLayout'

//   Improve this test with help from the Redwood Testing Doc:
//   https://cedarjs.com/docs/testing#testing-pages-layouts

describe('TestLayout', () => {
  it('renders successfully', () => {
    expect(() => {
      render(<TestLayout />)
    }).not.toThrow()
  })
})
