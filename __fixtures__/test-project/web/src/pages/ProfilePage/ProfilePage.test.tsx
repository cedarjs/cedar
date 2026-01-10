import { render, waitFor, screen } from '@cedarjs/testing/web'

import ProfilePage from './ProfilePage'

describe('ProfilePage', () => {
  it('renders successfully', async () => {
    mockCurrentUser({
      email: 'danny@bazinga.com',
      id: '4c3d3e8e-2b1a-4f5c-8c7d-9e0f1a2b3c4d',
      roles: 'BAZINGA',
    })

    await waitFor(async () => {
      expect(() => {
        render(<ProfilePage />)
      }).not.toThrow()
    })

    expect(await screen.findByText('danny@bazinga.com')).toBeInTheDocument()
  })
})
