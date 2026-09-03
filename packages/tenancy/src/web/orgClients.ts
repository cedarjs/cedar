import type { ApolloClient } from '@apollo/client'

/**
 * One Apollo client per `${userId}:${organizationId}`, keyed by the
 * organization's immutable id rather than its slug (a rename or a deleted
 * organization's reused slug must not hand out another tenant's cache). The
 * map is module-level so a tab keeps one client per organization it has
 * visited, sharing the transport and auth link with the app client while
 * giving each organization its own cache.
 */
const clients = new Map<string, ApolloClient>()

function clientKey(userId: string, organizationId: string): string {
  return `${userId}:${organizationId}`
}

export interface GetOrgClientOptions {
  userId: string
  organizationId: string
  /** Builds a new client. Only called on a cache miss. */
  createClient: () => ApolloClient
}

/**
 * Returns the Apollo client for one user's membership in one organization,
 * creating and caching it on first use so returning to an organization
 * reuses its client and cache.
 */
export function getOrgClient({
  userId,
  organizationId,
  createClient,
}: GetOrgClientOptions): ApolloClient {
  const key = clientKey(userId, organizationId)
  const existing = clients.get(key)

  if (existing) {
    return existing
  }

  const client = createClient()
  clients.set(key, client)

  return client
}

/**
 * Drops one organization's client, clearing its cache first. Called when a
 * memberships refresh shows the membership gone or its role changed, so
 * data cached under the previous authorization does not outlive it.
 */
export async function dropOrgClient(
  userId: string,
  organizationId: string,
): Promise<void> {
  const key = clientKey(userId, organizationId)
  const client = clients.get(key)

  if (!client) {
    return
  }

  clients.delete(key)
  await client.clearStore()
}

/**
 * Drops every organization client, clearing each cache first. Called when
 * `useAuth().isAuthenticated` turns false or `currentUser.id` changes, so a
 * different user in the same tab is never handed a previous user's client.
 * Also exported for tests and app logout hooks.
 */
export async function clearOrgClients(): Promise<void> {
  const clientsToClear = Array.from(clients.values())
  clients.clear()

  await Promise.all(clientsToClear.map((client) => client.clearStore()))
}
