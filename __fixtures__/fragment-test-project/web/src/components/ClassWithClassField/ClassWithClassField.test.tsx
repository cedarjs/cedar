import { render } from '@cedarjs/testing/web'

import ClassWithClassField from './ClassWithClassField'

//   Improve this test with help from the Redwood Testing Doc:
//    https://redwoodjs.com/docs/testing#testing-components

describe('ClassWithClassField', () => {
  it('renders successfully', () => {
    expect(() => {
      render(<ClassWithClassField />)
    }).not.toThrow()
  })
})
