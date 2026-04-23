import { render } from '@cedarjs/testing/web'

import GqlormTodosPage from './GqlormTodosPage'

//   Improve this test with help from the CedarJS Testing Doc:
//   https://cedarjs.com/docs/testing#testing-pages-layouts

describe('GqlormTodosPage', () => {
  it('renders successfully', () => {
    expect(() => {
      render(<GqlormTodosPage />)
    }).not.toThrow()
  })
})
