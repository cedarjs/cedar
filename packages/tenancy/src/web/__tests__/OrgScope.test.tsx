// @vitest-environment jsdom
import React from 'react'

import type { ApolloClient } from '@apollo/client'
import { gql } from '@apollo/client'
import { useApolloClient, useQuery } from '@apollo/client/react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import type { AuthContextInterface, UseAuth } from '@cedarjs/auth'
import {
  LocationProvider,
  navigate,
  ParamsProvider,
  Route,
  Router,
  Set,
} from '@cedarjs/router'
import { CedarApolloProvider } from '@cedarjs/web/apollo/CedarApolloProvider'

import { clearOrgClients } from '../orgClients.js'
import { OrgScope } from '../OrgScope.js'
import type { OrgMembership } from '../types.js'

globalThis.RWJS_API_GRAPHQL_URL = 'https://example.com/graphql'

const PROJECTS_QUERY = gql`
  query ProjectsQuery {
    projects
  }
`

function ProjectsView() {
  const { data, loading, error } = useQuery<{ projects: string }>(
    PROJECTS_QUERY,
  )

  if (error) {
    return <>error: {error.message}</>
  }

  if (loading) {
    return <>loading</>
  }

  return <>projects: {data?.projects}</>
}

function ClientCapture({
  onCapture,
}: {
  onCapture: (client: ApolloClient) => void
}) {
  const client = useApolloClient()
  onCapture(client)
  return null
}

function membership(
  organizationId: string,
  slug: string,
  name: string,
  role: string,
): OrgMembership {
  return {
    id: `membership_${organizationId}`,
    organizationId,
    role,
    organization: { id: organizationId, slug, name },
  }
}

// Matches the generic instantiation `UseAuth` expects (every type
// parameter widened to `unknown`), following the pattern in
// `packages/router/src/__tests__/router.test.tsx`.
type UnknownAuthContextInterface = AuthContextInterface<
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown
>

interface AuthState {
  isAuthenticated: boolean
  currentUser: { id: string; memberships: OrgMembership[] } | null
}

/**
 * Builds a `UseAuth` whose return value tracks `state` live: mutating
 * `state` and re-rendering (no extra wiring needed) is enough to simulate
 * login, logout and `reauthenticate()` picking up a fresh memberships
 * snapshot.
 */
function createUseAuth(state: AuthState): UseAuth {
  return () => {
    const values: UnknownAuthContextInterface = {
      loading: false,
      isAuthenticated: state.isAuthenticated,
      userMetadata: null,
      currentUser: state.currentUser,
      logIn: async () => null,
      logOut: async () => null,
      signUp: async () => null,
      getToken: async () => null,
      getCurrentUser: async () => null,
      hasRole: () => false,
      reauthenticate: async () => {},
      client: undefined,
      type: 'custom',
      hasError: false,
      forgotPassword: async () => null,
      resetPassword: async () => null,
      validateResetToken: async () => null,
    }

    return values
  }
}

function setupFetchMock() {
  const requests: { headers: Headers }[] = []

  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      requests.push({ headers })

      const org = headers.get('cedar-org')
      const projects = org ? `${org}-projects` : 'app-projects'

      return new Response(JSON.stringify({ data: { projects } }), {
        headers: { 'content-type': 'application/json' },
      })
    },
  )

  vi.stubGlobal('fetch', fetchMock)

  return { fetchMock, requests }
}

describe('OrgScope', () => {
  afterEach(async () => {
    vi.unstubAllGlobals()
    // The client map is module-level, shared across tests.
    await clearOrgClients()
  })

  test('two organizations visited in sequence get separate clients and caches; returning to the first reuses it', async () => {
    const { fetchMock } = setupFetchMock()
    const useAuth = createUseAuth({
      isAuthenticated: true,
      currentUser: {
        id: 'user_1',
        memberships: [
          membership('org_a', 'org-a', 'Org A', 'owner'),
          membership('org_b', 'org-b', 'Org B', 'owner'),
        ],
      },
    })

    const clients: ApolloClient[] = []
    const captureClient = (client: ApolloClient) => clients.push(client)

    const Tree = ({ orgSlug }: { orgSlug: string }) => (
      <LocationProvider>
        <ParamsProvider allParams={{}}>
          <CedarApolloProvider>
            <OrgScope useAuth={useAuth} orgSlug={orgSlug}>
              <ClientCapture onCapture={captureClient} />
              <ProjectsView />
            </OrgScope>
          </CedarApolloProvider>
        </ParamsProvider>
      </LocationProvider>
    )

    const { rerender } = render(<Tree orgSlug="org-a" />)
    await waitFor(() => screen.getByText('projects: org_a-projects'))

    rerender(<Tree orgSlug="org-b" />)
    await waitFor(() => screen.getByText('projects: org_b-projects'))

    rerender(<Tree orgSlug="org-a" />)
    await waitFor(() => screen.getByText('projects: org_a-projects'))

    expect(fetchMock).toHaveBeenCalled()

    const clientA = clients[0]
    const clientB = clients.find((client) => client !== clientA)

    expect(clientB).toBeDefined()
    expect(clientA.cache).not.toBe(clientB!.cache)
    // Returning to org A reuses its exact client instance.
    expect(clients[clients.length - 1]).toBe(clientA)
  })

  test('a slug with no membership renders the not-a-member state and issues no request', async () => {
    const { fetchMock } = setupFetchMock()
    const useAuth = createUseAuth({
      isAuthenticated: true,
      currentUser: {
        id: 'user_1',
        memberships: [membership('org_a', 'org-a', 'Org A', 'owner')],
      },
    })

    render(
      <LocationProvider>
        <ParamsProvider allParams={{}}>
          <CedarApolloProvider>
            <OrgScope
              useAuth={useAuth}
              orgSlug="does-not-exist"
              notAMember="not a member"
            >
              <ProjectsView />
            </OrgScope>
          </CedarApolloProvider>
        </ParamsProvider>
      </LocationProvider>,
    )

    await screen.findByText('not a member')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('a query issued above OrgScope carries no cedar-org header', async () => {
    const { requests } = setupFetchMock()
    const useAuth = createUseAuth({
      isAuthenticated: true,
      currentUser: {
        id: 'user_1',
        memberships: [membership('org_a', 'org-a', 'Org A', 'owner')],
      },
    })

    render(
      <LocationProvider>
        <ParamsProvider allParams={{}}>
          <CedarApolloProvider>
            <ProjectsView />
            <OrgScope useAuth={useAuth} orgSlug="org-a">
              <ProjectsView />
            </OrgScope>
          </CedarApolloProvider>
        </ParamsProvider>
      </LocationProvider>,
    )

    await waitFor(() => expect(requests).toHaveLength(2))

    const appRequest = requests.find(
      (request) => !request.headers.has('cedar-org'),
    )
    const orgRequest = requests.find((request) =>
      request.headers.has('cedar-org'),
    )

    expect(appRequest).toBeDefined()
    expect(orgRequest?.headers.get('cedar-org')).toBe('org_a')
  })

  test('logging out then in as another user gives a fresh client for the same slug, with an empty cache', async () => {
    setupFetchMock()
    const authState: AuthState = {
      isAuthenticated: true,
      currentUser: {
        id: 'user_1',
        memberships: [membership('org_1', 'acme', 'Acme', 'owner')],
      },
    }
    const useAuth = createUseAuth(authState)

    const clients: ApolloClient[] = []
    const captureClient = (client: ApolloClient) => clients.push(client)

    const Tree = () => (
      <LocationProvider>
        <ParamsProvider allParams={{}}>
          <CedarApolloProvider>
            <OrgScope
              useAuth={useAuth}
              orgSlug="acme"
              notAMember="not a member"
            >
              <ClientCapture onCapture={captureClient} />
              <ProjectsView />
            </OrgScope>
          </CedarApolloProvider>
        </ParamsProvider>
      </LocationProvider>
    )

    const { rerender } = render(<Tree />)
    await waitFor(() => screen.getByText('projects: org_1-projects'))
    const firstUserClient = clients[clients.length - 1]

    // Log out.
    authState.isAuthenticated = false
    authState.currentUser = null
    rerender(<Tree />)
    await screen.findByText('not a member')

    // Log in as a different user, whose organization happens to reuse the
    // same slug under a different id.
    authState.isAuthenticated = true
    authState.currentUser = {
      id: 'user_2',
      memberships: [membership('org_9', 'acme', 'Acme (user 2)', 'owner')],
    }
    rerender(<Tree />)
    await waitFor(() => screen.getByText('projects: org_9-projects'))

    const secondUserClient = clients[clients.length - 1]

    expect(secondUserClient).not.toBe(firstUserClient)
    expect(secondUserClient.cache).not.toBe(firstUserClient.cache)
  })

  test('a role change surfaced by a memberships refresh drops that org client', async () => {
    setupFetchMock()
    const authState: AuthState = {
      isAuthenticated: true,
      currentUser: {
        id: 'user_1',
        memberships: [membership('org_1', 'acme', 'Acme', 'member')],
      },
    }
    const useAuth = createUseAuth(authState)

    const clients: ApolloClient[] = []
    const captureClient = (client: ApolloClient) => clients.push(client)

    const Tree = () => (
      <LocationProvider>
        <ParamsProvider allParams={{}}>
          <CedarApolloProvider>
            <OrgScope useAuth={useAuth} orgSlug="acme">
              <ClientCapture onCapture={captureClient} />
              <ProjectsView />
            </OrgScope>
          </CedarApolloProvider>
        </ParamsProvider>
      </LocationProvider>
    )

    const { rerender } = render(<Tree />)
    await waitFor(() => screen.getByText('projects: org_1-projects'))
    const clientBeforeRoleChange = clients[clients.length - 1]

    authState.currentUser = {
      id: 'user_1',
      memberships: [membership('org_1', 'acme', 'Acme', 'admin')],
    }
    rerender(<Tree />)
    await waitFor(() =>
      expect(clients[clients.length - 1]).not.toBe(clientBeforeRoleChange),
    )

    const clientAfterRoleChange = clients[clients.length - 1]

    expect(clientAfterRoleChange.cache).not.toBe(clientBeforeRoleChange.cache)
  })

  test('a removed membership drops that org client; re-adding it later gets a fresh one', async () => {
    setupFetchMock()
    const authState: AuthState = {
      isAuthenticated: true,
      currentUser: {
        id: 'user_1',
        memberships: [membership('org_1', 'acme', 'Acme', 'owner')],
      },
    }
    const useAuth = createUseAuth(authState)

    const clients: ApolloClient[] = []
    const captureClient = (client: ApolloClient) => clients.push(client)

    const Tree = () => (
      <LocationProvider>
        <ParamsProvider allParams={{}}>
          <CedarApolloProvider>
            <OrgScope
              useAuth={useAuth}
              orgSlug="acme"
              notAMember="not a member"
            >
              <ClientCapture onCapture={captureClient} />
              <ProjectsView />
            </OrgScope>
          </CedarApolloProvider>
        </ParamsProvider>
      </LocationProvider>
    )

    const { rerender } = render(<Tree />)
    await waitFor(() => screen.getByText('projects: org_1-projects'))
    const originalClient = clients[clients.length - 1]

    // The membership is removed (e.g. the member was kicked out).
    authState.currentUser = { id: 'user_1', memberships: [] }
    rerender(<Tree />)
    await screen.findByText('not a member')

    // The user is re-invited and re-joins the same organization.
    authState.currentUser = {
      id: 'user_1',
      memberships: [membership('org_1', 'acme', 'Acme', 'owner')],
    }
    rerender(<Tree />)
    await waitFor(() => screen.getByText('projects: org_1-projects'))

    const newClient = clients[clients.length - 1]

    expect(newClient).not.toBe(originalClient)
    expect(newClient.cache).not.toBe(originalClient.cache)
  })

  test('a renamed organization keeps its client, and matches the new slug only after the refresh', async () => {
    setupFetchMock()
    const authState: AuthState = {
      isAuthenticated: true,
      currentUser: {
        id: 'user_1',
        memberships: [membership('org_1', 'acme', 'Acme', 'owner')],
      },
    }
    const useAuth = createUseAuth(authState)

    const clients: ApolloClient[] = []
    const captureClient = (client: ApolloClient) => clients.push(client)

    const Tree = ({ orgSlug }: { orgSlug: string }) => (
      <LocationProvider>
        <ParamsProvider allParams={{}}>
          <CedarApolloProvider>
            <OrgScope
              useAuth={useAuth}
              orgSlug={orgSlug}
              notAMember="not a member"
            >
              <ClientCapture onCapture={captureClient} />
              <ProjectsView />
            </OrgScope>
          </CedarApolloProvider>
        </ParamsProvider>
      </LocationProvider>
    )

    // Before the rename is reflected in the memberships snapshot, the new
    // slug does not match anything.
    const { rerender } = render(<Tree orgSlug="acme-renamed" />)
    await screen.findByText('not a member')

    // The old slug still matches, and gets a client.
    rerender(<Tree orgSlug="acme" />)
    await waitFor(() => screen.getByText('projects: org_1-projects'))
    const clientBeforeRename = clients[clients.length - 1]

    // The organization is renamed; the memberships snapshot refreshes
    // (simulating `reauthenticate()`), and the app navigates to the new
    // slug.
    authState.currentUser = {
      id: 'user_1',
      memberships: [
        membership('org_1', 'acme-renamed', 'Acme Renamed', 'owner'),
      ],
    }
    rerender(<Tree orgSlug="acme-renamed" />)
    await waitFor(() => screen.getByText('projects: org_1-projects'))

    // Same organization id, so the client (and its cache) survived the
    // rename.
    expect(clients[clients.length - 1]).toBe(clientBeforeRename)

    // The old slug no longer matches once the rename has been refreshed.
    rerender(<Tree orgSlug="acme" />)
    await screen.findByText('not a member')
  })

  test('a new organization reusing a deleted organization slug gets a fresh client', async () => {
    setupFetchMock()
    const authState: AuthState = {
      isAuthenticated: true,
      currentUser: {
        id: 'user_1',
        memberships: [membership('org_1', 'acme', 'Acme', 'owner')],
      },
    }
    const useAuth = createUseAuth(authState)

    const clients: ApolloClient[] = []
    const captureClient = (client: ApolloClient) => clients.push(client)

    const Tree = () => (
      <LocationProvider>
        <ParamsProvider allParams={{}}>
          <CedarApolloProvider>
            <OrgScope useAuth={useAuth} orgSlug="acme">
              <ClientCapture onCapture={captureClient} />
              <ProjectsView />
            </OrgScope>
          </CedarApolloProvider>
        </ParamsProvider>
      </LocationProvider>
    )

    const { rerender } = render(<Tree />)
    await waitFor(() => screen.getByText('projects: org_1-projects'))
    const originalClient = clients[clients.length - 1]

    // org_1 is deleted; a different organization is created and reuses the
    // "acme" slug.
    authState.currentUser = {
      id: 'user_1',
      memberships: [membership('org_2', 'acme', 'New Acme', 'owner')],
    }
    rerender(<Tree />)
    await waitFor(() => screen.getByText('projects: org_2-projects'))

    const newClient = clients[clients.length - 1]

    expect(newClient).not.toBe(originalClient)
    expect(newClient.cache).not.toBe(originalClient.cache)
  })

  describe('route param path', () => {
    beforeEach(() => {
      window.history.pushState({}, '', '/')
    })

    test('OrgScope resolves orgSlug from the route param, wired through Set wrap', async () => {
      setupFetchMock()
      const useAuth = createUseAuth({
        isAuthenticated: true,
        currentUser: {
          id: 'user_1',
          memberships: [
            membership('org_a', 'org-a', 'Org A', 'owner'),
            membership('org_b', 'org-b', 'Org B', 'owner'),
          ],
        },
      })

      const OrgPage = () => <ProjectsView />

      render(
        <CedarApolloProvider>
          <Router>
            <Set wrap={OrgScope} useAuth={useAuth} notAMember="not a member">
              <Route path="/org/{orgSlug}" page={OrgPage} name="org" />
            </Set>
          </Router>
        </CedarApolloProvider>,
      )

      act(() => navigate('/org/org-a'))
      await waitFor(() => screen.getByText('projects: org_a-projects'))

      act(() => navigate('/org/org-b'))
      await waitFor(() => screen.getByText('projects: org_b-projects'))
    })
  })
})
