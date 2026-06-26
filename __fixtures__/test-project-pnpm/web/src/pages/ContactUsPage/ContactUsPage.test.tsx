import { render } from '@cedarjs/testing/web'

import ContactUsPage from './ContactUsPage'

//   Improve this test with help from the CedarJS Testing Doc:
//   https://cedarjs.com/docs/testing#testing-pages-layouts

describe('ContactUsPage', () => {
  it('renders successfully', () => {
    expect(() => {
      render(<ContactUsPage />)
    }).not.toThrow()
  })
})
