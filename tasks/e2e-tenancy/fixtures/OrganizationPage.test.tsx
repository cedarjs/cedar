import { mockRouteParams, render, screen } from '@cedarjs/testing/web'

import OrganizationPage from './OrganizationPage'

/**
 * The page under the app's own `tenancy`, as the router renders it on
 * `/org/{orgSlug}`: the organization comes from the mocked user's
 * memberships and the mocked `orgSlug` route param.
 */
const mockMember = (
  permissions: ('organization.read' | 'members.manage')[],
) => {
  mockCurrentUser({
    id: 'user-1',
    email: 'member@example.com',
    memberships: [
      {
        id: 'membership-1',
        organizationId: 'org-acme',
        role: 'admin',
        permissions,
        organization: { id: 'org-acme', slug: 'acme', name: 'Acme' },
      },
    ],
  })
}

const mockOrganizationName = (name: string) => {
  mockGraphQLQuery('TenancyE2eOrganizationQuery', (variables) => ({
    organization: { id: variables.id, name },
  }))
}

describe('OrganizationPage', () => {
  it("shows the member's role and permissions in the organization", async () => {
    mockMember(['organization.read', 'members.manage'])
    mockRouteParams({ orgSlug: 'acme' })
    mockOrganizationName('Acme')

    render(<OrganizationPage />)

    expect(await screen.findByText('Acme')).toBeInTheDocument()
    expect(screen.getByText('Role: admin')).toBeInTheDocument()
    expect(screen.getByText('Can manage members: yes')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Invite' })).toBeInTheDocument()
  })

  it("doesn't show the invite form without members.manage", async () => {
    mockMember(['organization.read'])
    mockRouteParams({ orgSlug: 'acme' })
    mockOrganizationName('Acme')

    render(<OrganizationPage />)

    expect(await screen.findByText('Acme')).toBeInTheDocument()
    expect(screen.getByText('Can manage members: no')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Invite' })).toBeNull()
  })

  it("doesn't answer a query from an earlier test's cache", async () => {
    mockMember(['organization.read'])
    mockRouteParams({ orgSlug: 'acme' })
    mockOrganizationName('Acme Renamed')

    render(<OrganizationPage />)

    // An earlier test's 'Acme' would render straight from the cache
    expect(screen.queryByText('Acme')).toBeNull()
    expect(await screen.findByText('Acme Renamed')).toBeInTheDocument()
  })

  it("shows the tenancy's notAMember to a user who isn't a member", () => {
    mockMember(['organization.read'])
    mockRouteParams({ orgSlug: 'other-org' })

    render(<OrganizationPage />)

    expect(
      screen.getByText("You don't have access to this organization."),
    ).toBeInTheDocument()
  })

  it('throws outside an organization', () => {
    mockMember(['organization.read'])
    mockRouteParams({})
    // React logs the error it rethrows
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => render(<OrganizationPage />)).toThrow(
      /useCurrentOrg must be used under an organization route/,
    )
  })
})
