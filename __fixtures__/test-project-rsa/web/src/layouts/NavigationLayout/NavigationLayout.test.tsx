import { render } from '@cedarjs/testing/web'

import NavigationLayout from './NavigationLayout'

//   Improve this test with help from the Redwood Testing Doc:
//   https://cedarjs.com/docs/testing#testing-pages-layouts

describe('NavigationLayout', () => {
  it('renders successfully', () => {
    expect(() => {
      render(<NavigationLayout />)
    }).not.toThrow()
  })
})
