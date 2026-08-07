import { render } from '@cedarjs/testing/web'

import ClassWithClassField from './ClassWithClassField'

//   Improve this test with help from the CedarJS Testing Doc:
//    https://cedarjs.com/docs/testing#testing-components

describe('ClassWithClassField', () => {
  it('renders successfully', () => {
    expect(() => {
      render(<ClassWithClassField />)
    }).not.toThrow()
  })
})
