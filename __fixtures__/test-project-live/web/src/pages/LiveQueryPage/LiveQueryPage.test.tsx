import { render } from '@cedarjs/testing/web'

import LiveQueryPage from './LiveQueryPage'

//   Improve this test with help from the CedarJS Testing Doc:
//   https://cedarjs.com/docs/testing#testing-pages-layouts

describe('LiveQueryPage', () => {
  it('renders successfully', () => {
    expect(() => {
      render(<LiveQueryPage />)
    }).not.toThrow()
  })
})
