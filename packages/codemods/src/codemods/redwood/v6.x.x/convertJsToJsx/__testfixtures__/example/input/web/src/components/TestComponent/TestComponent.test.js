import { render } from '@cedarjs/testing/web'

import TestComponent from './TestComponent'

//   Improve this test with help from the Redwood Testing Doc:
//    https://cedarjs.com/docs/testing#testing-components

describe('TestComponent', () => {
  it('renders successfully', () => {
    expect(() => {
      render(<TestComponent />)
    }).not.toThrow()
  })
})
