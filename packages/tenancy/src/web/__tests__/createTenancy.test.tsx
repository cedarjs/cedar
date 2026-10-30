// @vitest-environment jsdom
import React from 'react'

import type { ApolloClient } from '@apollo/client'
import { gql } from '@apollo/client'
import { useApolloClient, useQuery } from '@apollo/client/react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import type { AuthContextInterface, UseAuth } from '@cedarjs/auth'
import { HasPermissionContext } from '@cedarjs/auth'
import {
  navigate,
  PrivateSet,
  Route,
  Router,
  Set,
  useParams,
} from '@cedarjs/router'
import type { Tenancy } from '@cedarjs/router'
import { CedarApolloProvider } from '@cedarjs/web/apollo/CedarApolloProvider'

import { createTenancy } from '../createTenancy.js'
import { clearOrgClients } from '../orgClients.js'
import type { OrgMembership } from '../types.js'
import { useCurrentOrg } from '../useCurrentOrg.js'
import { useOrgBySlug } from '../useOrgBySlug.js'

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
      hasUserRole: () => false,
      hasPermission: () => false,
      reauthenticate: async () => {},
      client: undefined,
      type: 'custom',
      hasError: false,
      forgotPassword: async () => null,
      resetPassword: async () => null,
      validateResetToken: async () => null,
      changePassword: async () => null,
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

const LoginPage = () => <>login</>

/** What a client's cache holds of the \`projects\` query */
function cachedProjects(client: ApolloClient) {
  return client.cache.extract()['ROOT_QUERY']?.['projects']
}

describe('createTenancy', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/')
  })

  afterEach(async () => {
    cleanup()
    vi.unstubAllGlobals()
    // The client map is module-level, shared across tests.
    await clearOrgClients()
  })

  /**
   * An app with the tenancy on its router, and `children` in a private set
   * at `/org/{orgSlug}`. The router is an app without tenancy, where it has
   * no `tenancy` prop, so it is spread to get through the type check.
   */
  function renderApp({
    useAuth,
    tenancy = createTenancy({ notAMember: 'not a member' }),
    children = (
      <>
        <ClientCapture onCapture={() => {}} />
        <ProjectsView />
      </>
    ),
  }: {
    useAuth: UseAuth
    tenancy?: Tenancy
    children?: React.ReactNode
  }) {
    const OrgPage = () => <>{children}</>

    const App = () => (
      <CedarApolloProvider>
        <Router useAuth={useAuth} {...{ tenancy }}>
          <Route path="/login" page={LoginPage} name="login" />
          <PrivateSet unauthenticated="login">
            <Route path="/org/{orgSlug}" page={OrgPage} name="org" />
          </PrivateSet>
        </Router>
      </CedarApolloProvider>
    )

    return render(<App />)
  }

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

    renderApp({
      useAuth,
      children: (
        <>
          <ClientCapture onCapture={(client) => clients.push(client)} />
          <ProjectsView />
        </>
      ),
    })

    act(() => navigate('/org/org-a'))
    await waitFor(() => screen.getByText('projects: org_a-projects'))

    act(() => navigate('/org/org-b'))
    await waitFor(() => screen.getByText('projects: org_b-projects'))

    act(() => navigate('/org/org-a'))
    await waitFor(() => screen.getByText('projects: org_a-projects'))
    expect(fetchMock).toHaveBeenCalled()

    const clientA = clients[0]
    const clientB = clients.find((client) => client !== clientA)

    expect(clientB).toBeDefined()
    expect(clientA.cache).not.toBe(clientB!.cache)
    // Returning to org A reuses its exact client instance.
    expect(clients[clients.length - 1]).toBe(clientA)
  })

  test('a slug with no membership renders notAMember and issues no request', async () => {
    const { fetchMock } = setupFetchMock()
    const useAuth = createUseAuth({
      isAuthenticated: true,
      currentUser: {
        id: 'user_1',
        memberships: [membership('org_a', 'org-a', 'Org A', 'owner')],
      },
    })

    renderApp({ useAuth })

    act(() => navigate('/org/does-not-exist'))

    await screen.findByText('not a member')

    const queries = fetchMock.mock.calls.map(([, init]) => String(init?.body))
    expect(queries.filter((body) => body.includes('ProjectsQuery'))).toEqual([])
  })

  test('a query issued above the provider carries no cedar-org header', async () => {
    const { requests } = setupFetchMock()
    const useAuth = createUseAuth({
      isAuthenticated: true,
      currentUser: {
        id: 'user_1',
        memberships: [membership('org_a', 'org-a', 'Org A', 'owner')],
      },
    })

    window.history.pushState({}, '', '/org/org-a')

    // The app's own client, above the Router
    render(
      <CedarApolloProvider>
        <ProjectsView />
        <Router
          useAuth={useAuth}
          {...{ tenancy: createTenancy({ notAMember: 'not a member' }) }}
        >
          <Route path="/login" page={LoginPage} name="login" />
          <PrivateSet unauthenticated="login">
            <Route path="/org/{orgSlug}" page={ProjectsView} name="org" />
          </PrivateSet>
        </Router>
      </CedarApolloProvider>,
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

  test('signing out clears the organization clients, and another user gets a fresh client for the same slug', async () => {
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

    renderApp({
      useAuth,
      children: (
        <>
          <ClientCapture onCapture={(client) => clients.push(client)} />
          <ProjectsView />
        </>
      ),
    })

    act(() => navigate('/org/acme'))
    await waitFor(() => screen.getByText('projects: org_1-projects'))
    const firstUserClient = clients[clients.length - 1]
    expect(cachedProjects(firstUserClient)).toBeDefined()

    // Log out. The router redirects to the login page, so the provider is
    // gone, and the tenancy still clears the client.
    authState.isAuthenticated = false
    authState.currentUser = null
    act(() => navigate('/org/acme?signedOut'))
    await screen.findByText('login')
    await waitFor(() => expect(cachedProjects(firstUserClient)).toBeUndefined())

    // Log in as a different user, whose organization happens to reuse the
    // same slug under a different id.
    authState.isAuthenticated = true
    authState.currentUser = {
      id: 'user_2',
      memberships: [membership('org_9', 'acme', 'Acme (user 2)', 'owner')],
    }
    act(() => navigate('/org/acme'))
    await waitFor(() => screen.getByText('projects: org_9-projects'))

    const secondUserClient = clients[clients.length - 1]

    expect(secondUserClient).not.toBe(firstUserClient)
    expect(secondUserClient.cache).not.toBe(firstUserClient.cache)
  })

  test('a role change surfaced by a memberships refresh gives a fresh client', async () => {
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

    renderApp({
      useAuth,
      children: (
        <>
          <ClientCapture onCapture={(client) => clients.push(client)} />
          <ProjectsView />
        </>
      ),
    })

    act(() => navigate('/org/acme'))
    await waitFor(() => screen.getByText('projects: org_1-projects'))
    const clientBeforeRoleChange = clients[clients.length - 1]

    authState.currentUser = {
      id: 'user_1',
      memberships: [membership('org_1', 'acme', 'Acme', 'admin')],
    }
    // A new location re-renders the router, like `reauthenticate()` does
    act(() => navigate('/org/acme?refreshed'))

    await waitFor(() =>
      expect(clients[clients.length - 1]).not.toBe(clientBeforeRoleChange),
    )

    expect(clients[clients.length - 1].cache).not.toBe(
      clientBeforeRoleChange.cache,
    )
  })

  test('switching straight to another user keeps the new user client across later renders', async () => {
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

    renderApp({
      useAuth,
      children: (
        <>
          <ClientCapture onCapture={(client) => clients.push(client)} />
          <ProjectsView />
        </>
      ),
    })

    act(() => navigate('/org/acme'))
    await waitFor(() => screen.getByText('projects: org_1-projects'))
    const firstUserClient = clients[clients.length - 1]

    // Like `reauthenticate()` returning another user, with no sign-out between
    authState.currentUser = {
      id: 'user_2',
      memberships: [membership('org_9', 'acme', 'Acme (user 2)', 'owner')],
    }
    act(() => navigate('/org/acme?switched'))
    await waitFor(() => screen.getByText('projects: org_9-projects'))
    const secondUserClient = clients[clients.length - 1]

    expect(secondUserClient).not.toBe(firstUserClient)
    expect(cachedProjects(firstUserClient)).toBeUndefined()

    // Later renders in the same organization reuse the new user's client
    act(() => navigate('/org/acme?later'))
    await waitFor(() => expect(window.location.search).toBe('?later'))
    await screen.findByText('projects: org_9-projects')

    // `Set` here is the router's component, so the built-in one by its
    // global name: the clients created, each once, in order
    expect([...new globalThis.Set(clients)]).toEqual([
      firstUserClient,
      secondUserClient,
    ])
    expect(clients[clients.length - 1]).toBe(secondUserClient)
    expect(cachedProjects(secondUserClient)).toBeDefined()
  })

  test('a role change while no provider is mounted still gives a fresh client', async () => {
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

    renderApp({
      useAuth,
      children: (
        <>
          <ClientCapture onCapture={(client) => clients.push(client)} />
          <ProjectsView />
        </>
      ),
    })

    act(() => navigate('/org/acme'))
    await waitFor(() => screen.getByText('projects: org_1-projects'))
    const ownerClient = clients[clients.length - 1]

    // Away from the organization, the role changes while the provider is
    // gone, and a new provider mounts with the new role
    act(() => navigate('/login'))
    await screen.findByText('login')
    authState.currentUser = {
      id: 'user_1',
      memberships: [membership('org_1', 'acme', 'Acme', 'member')],
    }
    act(() => navigate('/org/acme'))
    await waitFor(() => screen.getByText('projects: org_1-projects'))

    const memberClient = clients[clients.length - 1]

    expect(memberClient).not.toBe(ownerClient)
    expect(memberClient.cache).not.toBe(ownerClient.cache)
  })

  test('a removed membership renders notAMember and drops that org client; re-adding it later gets a fresh one', async () => {
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

    renderApp({
      useAuth,
      children: (
        <>
          <ClientCapture onCapture={(client) => clients.push(client)} />
          <ProjectsView />
        </>
      ),
    })

    act(() => navigate('/org/acme'))
    await waitFor(() => screen.getByText('projects: org_1-projects'))
    const originalClient = clients[clients.length - 1]

    // The membership is removed (e.g. the member was kicked out).
    authState.currentUser = { id: 'user_1', memberships: [] }
    act(() => navigate('/org/acme?refreshed'))
    await screen.findByText('not a member')
    await waitFor(() => expect(cachedProjects(originalClient)).toBeUndefined())

    // The user is re-invited and re-joins the same organization.
    authState.currentUser = {
      id: 'user_1',
      memberships: [membership('org_1', 'acme', 'Acme', 'owner')],
    }
    act(() => navigate('/org/acme'))
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

    renderApp({
      useAuth,
      children: (
        <>
          <ClientCapture onCapture={(client) => clients.push(client)} />
          <ProjectsView />
        </>
      ),
    })

    // Before the rename is reflected in the memberships snapshot, the new
    // slug does not match anything.
    act(() => navigate('/org/acme-renamed'))
    await screen.findByText('not a member')

    // The old slug still matches, and gets a client.
    act(() => navigate('/org/acme'))
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
    act(() => navigate('/org/acme-renamed'))
    await waitFor(() => screen.getByText('projects: org_1-projects'))

    // Same organization id, so the client (and its cache) survived the
    // rename.
    expect(clients[clients.length - 1]).toBe(clientBeforeRename)

    // The old slug no longer matches once the rename has been refreshed.
    act(() => navigate('/org/acme'))
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

    renderApp({
      useAuth,
      children: (
        <>
          <ClientCapture onCapture={(client) => clients.push(client)} />
          <ProjectsView />
        </>
      ),
    })

    act(() => navigate('/org/acme'))
    await waitFor(() => screen.getByText('projects: org_1-projects'))
    const originalClient = clients[clients.length - 1]

    // org_1 is deleted; a different organization is created and reuses the
    // "acme" slug.
    authState.currentUser = {
      id: 'user_1',
      memberships: [membership('org_2', 'acme', 'New Acme', 'owner')],
    }
    act(() => navigate('/org/acme?refreshed'))
    await waitFor(() => screen.getByText('projects: org_2-projects'))

    const newClient = clients[clients.length - 1]

    expect(newClient).not.toBe(originalClient)
    expect(newClient.cache).not.toBe(originalClient.cache)
  })

  describe('useCurrentOrg', () => {
    const useAuth = createUseAuth({
      isAuthenticated: true,
      currentUser: {
        id: 'user_1',
        memberships: [
          membership('org_a', 'org-a', 'Org A', 'member'),
          membership('org_b', 'org-b', 'Org B', 'owner'),
        ],
      },
    })

    const CurrentOrg = () => {
      const { org, memberships, setOrg } = useCurrentOrg()

      return (
        <>
          <p>
            org: {org?.slug} ({org?.role}), {memberships.length} memberships
          </p>
          <button onClick={() => setOrg('org-b')}>switch</button>
        </>
      )
    }

    test('gives the organization and the memberships', async () => {
      setupFetchMock()
      renderApp({ useAuth, children: <CurrentOrg /> })

      act(() => navigate('/org/org-a'))

      await screen.findByText('org: org-a (member), 2 memberships')
    })

    test('setOrg navigates to the same page of another organization', async () => {
      setupFetchMock()
      renderApp({ useAuth, children: <CurrentOrg /> })

      act(() => navigate('/org/org-a?tab=1'))
      await screen.findByText('org: org-a (member), 2 memberships')

      act(() => screen.getByText('switch').click())

      await screen.findByText('org: org-b (owner), 2 memberships')
      expect(window.location.pathname).toBe('/org/org-b')
      expect(window.location.search).toBe('?tab=1')
    })

    test('setOrg takes an organization id too, and navigates to its slug', async () => {
      setupFetchMock()
      const SwitchById = () => {
        const { setOrg } = useCurrentOrg()

        return <button onClick={() => setOrg('org_b')}>switch by id</button>
      }
      renderApp({ useAuth, children: <SwitchById /> })

      act(() => navigate('/org/org-a'))
      await screen.findByText('switch by id')

      act(() => screen.getByText('switch by id').click())

      await waitFor(() => expect(window.location.pathname).toBe('/org/org-b'))
    })

    test('setOrg calls onSetOrg instead of navigating', async () => {
      setupFetchMock()
      const onSetOrg = vi.fn()
      renderApp({
        useAuth,
        tenancy: createTenancy({ onSetOrg }),
        children: <CurrentOrg />,
      })

      act(() => navigate('/org/org-a'))
      await screen.findByText('org: org-a (member), 2 memberships')

      act(() => screen.getByText('switch').click())

      expect(onSetOrg).toHaveBeenCalledWith('org-b')
      expect(window.location.pathname).toBe('/org/org-a')
    })

    test('throws outside an organization route', async () => {
      const err = console.error
      console.error = vi.fn()

      try {
        expect(() => render(<CurrentOrg />)).toThrow(
          'useCurrentOrg must be used under an organization route',
        )
      } finally {
        console.error = err
      }
    })
  })

  describe('useOrg', () => {
    test('an organization from somewhere other than the path', async () => {
      setupFetchMock()
      const useAuth = createUseAuth({
        isAuthenticated: true,
        currentUser: {
          id: 'user_1',
          memberships: [
            membership('org_a', 'org-a', 'Org A', 'member'),
            membership('org_b', 'org-b', 'Org B', 'owner'),
          ],
        },
      })

      const tenancy = createTenancy({
        // Like an organization from the subdomain
        useOrg: (useAuth) => useOrgBySlug(useAuth, 'org-b'),
        notAMember: 'not a member',
      })

      const Org = () => <>{useCurrentOrg().org?.slug}</>
      const App = () => (
        <CedarApolloProvider>
          <Router useAuth={useAuth} {...{ tenancy }}>
            <Route path="/login" page={LoginPage} name="login" />
            <PrivateSet unauthenticated="login">
              <Route path="/projects" page={Org} name="projects" />
            </PrivateSet>
          </Router>
        </CedarApolloProvider>
      )

      render(<App />)
      act(() => navigate('/projects'))

      await screen.findByText('org-b')
    })

    test('is still the teardown when the app has its own', async () => {
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

      renderApp({
        useAuth,
        tenancy: createTenancy({
          useOrg: (useAuth, params) => useOrgBySlug(useAuth, params['orgSlug']),
        }),
        children: (
          <>
            <ClientCapture onCapture={(client) => clients.push(client)} />
            <ProjectsView />
          </>
        ),
      })

      act(() => navigate('/org/acme'))
      await waitFor(() => screen.getByText('projects: org_1-projects'))
      const client = clients[clients.length - 1]

      authState.isAuthenticated = false
      authState.currentUser = null
      act(() => navigate('/org/acme?signedOut'))
      await screen.findByText('login')
      await waitFor(() => expect(cachedProjects(client)).toBeUndefined())
    })
  })

  describe('permissions', () => {
    const withPermissions = (
      m: OrgMembership,
      permissions: string[],
    ): OrgMembership => ({ ...m, permissions })

    const useAuth = createUseAuth({
      isAuthenticated: true,
      currentUser: {
        id: 'user_1',
        memberships: [
          withPermissions(membership('org_a', 'org-a', 'Org A', 'member'), [
            'projects.read',
          ]),
          withPermissions(membership('org_b', 'org-b', 'Org B', 'owner'), [
            'projects.read',
            'settings.edit',
          ]),
        ],
      },
    })

    test("makes useAuth().hasPermission check the organization's membership", async () => {
      setupFetchMock()

      const Can = () => {
        const hasPermission = React.useContext(HasPermissionContext)
        return (
          <>
            read: {String(hasPermission?.('projects.read'))}, edit:{' '}
            {String(hasPermission?.('settings.edit'))}
          </>
        )
      }

      renderApp({ useAuth, children: <Can /> })

      act(() => navigate('/org/org-a'))
      await screen.findByText('read: true, edit: false')

      act(() => navigate('/org/org-b'))
      await screen.findByText('read: true, edit: true')
    })
  })

  describe('guarding routes', () => {
    const useAuth = createUseAuth({
      isAuthenticated: true,
      currentUser: {
        id: 'user_1',
        memberships: [
          { ...membership('org_a', 'org-a', 'Org A', 'member') },
          {
            ...membership('org_b', 'org-b', 'Org B', 'owner'),
            permissions: ['members.manage'],
          },
        ],
      },
    })

    const OrgPage = () => <ProjectsView />
    const OrgHomePage = () => <>org home</>

    // These tests are an app without tenancy, where sets have no
    // `orgPermission` prop and the router no `tenancy`. Spreading them lets
    // them through the type check.
    const canManageMembers = { orgPermission: 'members.manage' }
    const tenancy = createTenancy({ notAMember: 'not a member' })

    test('a nested <PrivateSet orgPermission> redirects to unauthorized with the URL’s orgSlug', async () => {
      setupFetchMock()

      render(
        <CedarApolloProvider>
          <Router useAuth={useAuth} {...{ tenancy }}>
            <Route path="/login" page={LoginPage} name="login" />
            <PrivateSet unauthenticated="login">
              <Route
                path="/org/{orgSlug}/home"
                page={OrgHomePage}
                name="orgHome"
              />
              <PrivateSet
                unauthenticated="login"
                unauthorized="orgHome"
                {...canManageMembers}
              >
                <Route path="/org/{orgSlug}" page={OrgPage} name="org" />
              </PrivateSet>
            </PrivateSet>
          </Router>
        </CedarApolloProvider>,
      )

      // Manages the members of org B, but not of org A
      act(() => navigate('/org/org-b'))
      await waitFor(() => screen.getByText('projects: org_b-projects'))

      act(() => navigate('/org/org-a'))
      await waitFor(() => screen.getByText('org home'))
      expect(window.location.pathname).toBe('/org/org-a/home')
    })

    test('<PrivateSet orgPermission> checks the permission in the URL’s organization', async () => {
      setupFetchMock()

      render(
        <CedarApolloProvider>
          <Router useAuth={useAuth} {...{ tenancy }}>
            <Route path="/login" page={LoginPage} name="login" />
            <PrivateSet unauthenticated="login">
              <Route
                path="/org/{orgSlug}/home"
                page={OrgHomePage}
                name="orgHome"
              />
            </PrivateSet>
            <PrivateSet
              unauthenticated="login"
              unauthorized="orgHome"
              {...canManageMembers}
            >
              <Route path="/org/{orgSlug}" page={OrgPage} name="org" />
            </PrivateSet>
          </Router>
        </CedarApolloProvider>,
      )

      act(() => navigate('/org/org-b'))
      await waitFor(() => screen.getByText('projects: org_b-projects'))

      act(() => navigate('/org/org-a'))
      await waitFor(() => screen.getByText('org home'))
      expect(window.location.pathname).toBe('/org/org-a/home')
    })

    test('an organization page in a plain Set is public, with no provider', async () => {
      setupFetchMock()
      const Public = () => {
        const { orgSlug } = useParams()

        return <>public page of {orgSlug}</>
      }

      render(
        <CedarApolloProvider>
          <Router useAuth={useAuth} {...{ tenancy }}>
            <Set>
              <Route path="/orgs/{orgSlug}" page={Public} name="public" />
            </Set>
          </Router>
        </CedarApolloProvider>,
      )

      act(() => navigate('/orgs/anything'))
      await screen.findByText('public page of anything')
    })
  })
})
