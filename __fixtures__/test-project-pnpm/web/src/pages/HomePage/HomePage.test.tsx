import { render, screen } from '@cedarjs/testing/web'

import HomePage from './HomePage'

describe('HomePage', () => {
  it('renders the blog posts from the cell mock', async () => {
    render(<HomePage />)

    const titles = await screen.findAllByText('Mocked title')

    expect(titles).toHaveLength(3)
  })
})
