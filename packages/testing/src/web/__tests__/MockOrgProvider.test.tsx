import React from 'react'

import { render, screen } from '@testing-library/react'
import { afterEach, describe, it, expect } from 'vitest'

import { LocationProvider } from '@cedarjs/router'
import type {
  OrgProviderProps,
  RouterMembership,
  Tenancy,
} from '@cedarjs/router'

import { useAuth } from '../mockAuth.js'
import { MockOrgProvider } from '../MockOrgProvider.js'
import { MockParamsProvider } from '../MockParamsProvider.js'
import { mockCurrentUser, mockRouteParams } from '../mockRequests.js'
import { mockedTenancyMeta } from '../mockTenancy.js'

const acmeMembership: RouterMembership = {
  organizationId: 'org-acme',
  role: 'admin',
  permissions: ['members.manage'],
}

/**
 * A tenancy like the default one from `createTenancy`: the organization is
 * the route's `orgSlug`, and the user's membership in it comes from
 * `currentUser.memberships`
 */
const tenancy: Tenancy = {
  useOrg: (useAuthHook, params) => {
    const { currentUser } = useAuthHook()

    if (params['orgSlug'] === undefined) {
      return null
    }

    const memberships =
      currentUser &&
      typeof currentUser === 'object' &&
      'memberships' in currentUser &&
      Array.isArray(currentUser.memberships)
        ? currentUser.memberships.filter(
            (m): m is RouterMembership & { slug: string } =>
              typeof m === 'object' && m !== null && 'slug' in m,
          )
        : []

    return {
      membership: memberships.find((m) => m.slug === params['orgSlug']) ?? null,
      memberships,
    }
  },
  OrgProvider: ({ membership, children }: OrgProviderProps) => (
    <div data-testid="org-provider" data-role={membership.role}>
      {children}
    </div>
  ),
  notAMember: <p>Not a member</p>,
}

const renderInMockProviders = () =>
  render(
    <LocationProvider>
      <MockParamsProvider>
        <MockOrgProvider>
          <p>Page</p>
        </MockOrgProvider>
      </MockParamsProvider>
    </LocationProvider>,
  )

describe('MockOrgProvider', () => {
  afterEach(() => {
    mockedTenancyMeta.tenancy = undefined
    mockCurrentUser(null)
    mockRouteParams({})
  })

  it('renders children without a provider in an app without tenancy', () => {
    mockRouteParams({ orgSlug: 'acme' })

    renderInMockProviders()

    expect(screen.getByText('Page')).toBeInTheDocument()
    expect(screen.queryByTestId('org-provider')).not.toBeInTheDocument()
  })

  it("renders children without a provider when the tenancy's useOrg finds no organization", () => {
    mockedTenancyMeta.tenancy = tenancy
    mockCurrentUser({ id: 'user-1', memberships: [] })

    renderInMockProviders()

    expect(screen.getByText('Page')).toBeInTheDocument()
    expect(screen.queryByTestId('org-provider')).not.toBeInTheDocument()
  })

  it("renders the tenancy's provider with the user's membership in the route's organization", () => {
    mockedTenancyMeta.tenancy = tenancy
    mockCurrentUser({
      id: 'user-1',
      memberships: [{ ...acmeMembership, slug: 'acme' }],
    })
    mockRouteParams({ orgSlug: 'acme' })

    renderInMockProviders()

    expect(screen.getByText('Page')).toBeInTheDocument()
    expect(screen.getByTestId('org-provider')).toHaveAttribute(
      'data-role',
      'admin',
    )
  })

  it("doesn't find the organization from a search param", () => {
    mockedTenancyMeta.tenancy = tenancy
    mockCurrentUser({
      id: 'user-1',
      memberships: [{ ...acmeMembership, slug: 'acme' }],
    })

    render(
      <LocationProvider location={new URL('https://example.com/?orgSlug=acme')}>
        <MockParamsProvider>
          <MockOrgProvider>
            <p>Page</p>
          </MockOrgProvider>
        </MockParamsProvider>
      </LocationProvider>,
    )

    expect(screen.getByText('Page')).toBeInTheDocument()
    expect(screen.queryByTestId('org-provider')).not.toBeInTheDocument()
  })

  it("renders the tenancy's notAMember for a user who isn't a member", () => {
    mockedTenancyMeta.tenancy = tenancy
    mockCurrentUser({ id: 'user-1', memberships: [] })
    mockRouteParams({ orgSlug: 'acme' })

    renderInMockProviders()

    expect(screen.getByText('Not a member')).toBeInTheDocument()
    expect(screen.queryByText('Page')).not.toBeInTheDocument()
  })

  it("passes the mocked useAuth to the tenancy's useOrg", () => {
    let receivedUseAuth: unknown
    mockedTenancyMeta.tenancy = {
      ...tenancy,
      useOrg: (useAuthHook) => {
        receivedUseAuth = useAuthHook
        return null
      },
    }

    renderInMockProviders()

    expect(receivedUseAuth).toBe(useAuth)
  })
})
