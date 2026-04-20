import { render } from '@cedarjs/testing/web'

import LiveTodos from './LiveTodos'

//   Improve this test with help from the CedarJS Testing Doc:
//    https://cedarjs.com/docs/testing#testing-components

describe('LiveTodos', () => {
  it('renders successfully', () => {
    expect(() => {
      render(<LiveTodos />)
    }).not.toThrow()
  })
})
