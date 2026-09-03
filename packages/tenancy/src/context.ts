import type { APIGatewayProxyEvent, Context as LambdaContext } from 'aws-lambda'

import type { Decoder } from '@cedarjs/api'
import { getAuthenticationContext, getEventHeader } from '@cedarjs/api'
import { context, setContext } from '@cedarjs/context'
import { getAsyncStoreInstance } from '@cedarjs/context/dist/store.js'
import { ForbiddenError } from '@cedarjs/graphql-server'

import { TenantScopeError } from './errors.js'

/**
 * The organization resolved for the current request: the identity fields
 * from `Organization`, plus the role and membership id derived from the
 * authenticated user's own membership in it.
 */
export interface CurrentOrg {
  id: string
  slug: string
  role: string
  membershipId: string
}

/**
 * The shape of a `Membership` row that `setCurrentOrg` and `resolveCurrentOrg`
 * need: enough to derive a `CurrentOrg` without importing a generated Prisma
 * type into this package.
 */
export interface MembershipSummary {
  id: string
  organizationId: string
  role: string
}

/**
 * The shape `getCurrentUser()` must return once an app has set up tenancy:
 * the user's memberships across every organization they belong to.
 */
export interface UserWithMemberships {
  memberships: MembershipSummary[]
}

/**
 * Request header carrying the organization the request targets, by id or by
 * slug. No `X-` prefix, per RFC 6648, matching the existing `auth-provider`
 * header.
 */
export const CEDAR_ORG_HEADER = 'cedar-org'

/**
 * Narrows an unknown `currentUser` value down to one carrying memberships,
 * without assuming anything else about its shape.
 */
export function isUserWithMemberships(
  value: unknown,
): value is UserWithMemberships {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { memberships?: unknown }).memberships)
  )
}

/**
 * Sets the current request's organization from its identity alone. `role`
 * and `membershipId` are derived from `currentUser.memberships`, never from
 * the caller, so nothing that calls this function can grant a role that
 * doesn't already exist. Throws `ForbiddenError` when the user has no
 * membership in the organization, the same error a non-member gets, so a
 * caller can't distinguish "no such organization" from "not your
 * organization".
 */
export function setCurrentOrg(
  org: { id: string; slug: string },
  currentUser: UserWithMemberships,
): CurrentOrg {
  const membership = currentUser.memberships.find(
    (m) => m.organizationId === org.id,
  )

  if (!membership) {
    throw new ForbiddenError('You are not a member of this organization.')
  }

  const currentOrg: CurrentOrg = {
    id: org.id,
    slug: org.slug,
    role: membership.role,
    membershipId: membership.id,
  }

  context.currentOrg = currentOrg

  return currentOrg
}

/**
 * Reads the organization set on the current request context, if any.
 */
export function getCurrentOrg(): CurrentOrg | undefined {
  return context.currentOrg
}

/**
 * Reads the organization set on the current request context. Throws
 * `TenantScopeError` when none is set, for code that cannot proceed without
 * one (the Prisma extension uses the same error for the same reason).
 */
export function requireCurrentOrg(): CurrentOrg {
  const currentOrg = getCurrentOrg()

  if (!currentOrg) {
    throw new TenantScopeError(
      'No organization is set on the current request. Send the ' +
        `\`${CEDAR_ORG_HEADER}\` header, or an \`orgId\`/\`orgSlug\` variable, ` +
        'to select one.',
    )
  }

  return currentOrg
}

/**
 * Resolves the organization a request targets and sets it on the context.
 *
 * Resolution order: the `cedar-org` request header, then the `orgId`
 * GraphQL variable, then the `orgSlug` variable. When none is present, the
 * request has no organization in scope: this returns `undefined` and sets
 * nothing, which is correct for anonymous requests and for operations that
 * don't touch tenant-owned data.
 *
 * An id or slug that doesn't resolve to an organization the user belongs to
 * — whether it doesn't exist at all, or exists but the user isn't a member —
 * is rejected the same way, with `ForbiddenError`, so a caller can't use this
 * function to probe which organizations exist.
 */
export async function resolveCurrentOrg(args: {
  event: APIGatewayProxyEvent | Request
  variables?: Record<string, unknown>
  currentUser: UserWithMemberships
  lookupOrg: (idOrSlug: string) => Promise<{ id: string; slug: string } | null>
}): Promise<CurrentOrg | undefined> {
  const { event, variables, currentUser, lookupOrg } = args

  const headerOrg = getEventHeader(event, CEDAR_ORG_HEADER)
  const orgIdOrSlug =
    headerOrg ||
    (typeof variables?.orgId === 'string' ? variables.orgId : undefined) ||
    (typeof variables?.orgSlug === 'string' ? variables.orgSlug : undefined)

  if (!orgIdOrSlug) {
    return undefined
  }

  const org = await lookupOrg(orgIdOrSlug)

  if (!org) {
    // Same error as "you're not a member": an unknown id/slug must not be
    // distinguishable from an organization that exists but isn't yours.
    throw new ForbiddenError('You are not a member of this organization.')
  }

  return setCurrentOrg(org, currentUser)
}

/**
 * Wraps a plain `api/src/functions/*` handler — one that doesn't go through
 * the GraphQL context — with the same request-context setup a GraphQL
 * request gets: it authenticates the request, loads the current user, and
 * resolves the current organization from the request headers, all inside a
 * fresh `@cedarjs/context` store, before calling the handler.
 *
 * An unauthenticated request, or one whose `getCurrentUser` result doesn't
 * carry memberships, still reaches the handler; it simply runs with no
 * `currentOrg` set, so any tenant-owned query inside it fails with
 * `TenantScopeError` unless the handler uses `db.$forOrg()` explicitly.
 */
export function withTenancy<
  Event extends APIGatewayProxyEvent | Request,
  Ctx extends LambdaContext = LambdaContext,
  Result = unknown,
>(
  handler: (event: Event, context: Ctx) => Promise<Result> | Result,
  options: {
    authDecoder: Decoder | Decoder[]
    getCurrentUser: (
      decoded: unknown,
      raw: { type: string; schema: string; token: string },
      req: {
        event: APIGatewayProxyEvent | Request
        request?: Request
        context?: LambdaContext
      },
    ) => Promise<unknown>
    lookupOrg: (
      idOrSlug: string,
    ) => Promise<{ id: string; slug: string } | null>
  },
): (event: Event, context: Ctx) => Promise<Result> {
  return async (event, lambdaContext) => {
    return getAsyncStoreInstance().run(new Map(), async () => {
      const authContext = await getAuthenticationContext({
        authDecoder: options.authDecoder,
        event,
        context: lambdaContext,
      })

      if (!authContext) {
        return handler(event, lambdaContext)
      }

      const [decoded, raw, req] = authContext
      const currentUser = await options.getCurrentUser(decoded, raw, req)
      setContext({ currentUser })

      if (isUserWithMemberships(currentUser)) {
        await resolveCurrentOrg({
          event,
          currentUser,
          lookupOrg: options.lookupOrg,
        })
      }

      return handler(event, lambdaContext)
    })
  }
}

declare module '@cedarjs/context' {
  interface GlobalContext {
    currentOrg?: CurrentOrg
  }
}
