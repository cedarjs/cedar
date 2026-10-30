import { render, screen } from '@cedarjs/testing/web'

import AdminNotice from './AdminNotice'

describe('AdminNotice', () => {
  it('shows for a user whose role has the permission', () => {
    mockCurrentUser({ roles: 'ADMIN' })
    render(<AdminNotice />)

    expect(screen.getByText('You may delete contacts')).toBeInTheDocument()
  })

  it('hides for a user whose roles lack it', () => {
    mockCurrentUser({ roles: 'EDITOR' })
    render(<AdminNotice />)

    expect(screen.queryByText('You may delete contacts')).toBeNull()
  })
})
