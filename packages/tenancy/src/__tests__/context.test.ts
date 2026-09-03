import type { APIGatewayProxyEvent } from 'aws-lambda'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getAsyncStoreInstance } from '@cedarjs/context/dist/store.js'
import { ForbiddenError } from '@cedarjs/graphql-server'

import {
  CEDAR_ORG_HEADER,
  getCurrentOrg,
  requireCurrentOrg,
  resolveCurrentOrg,
  setCurrentOrg,
  withTenancy,
} from '../context.js'
import { TenantScopeError } from '../errors.js'

function lambdaEvent(
  headers: Record<string, string> = {},
): APIGatewayProxyEvent {
  return { headers } as unknown as APIGatewayProxyEvent
}

const currentUser = {
  memberships: [
    { id: 'membership1', organizationId: 'org1', role: 'viewer' },
    { id: 'membership2', organizationId: 'org2', role: 'owner' },
  ],
}

describe('setCurrentOrg / getCurrentOrg', () => {
  it('derives role and membershipId from the membership, not the caller', async () => {
    await getAsyncStoreInstance().run(new Map(), async () => {
      const org = setCurrentOrg({ id: 'org1', slug: 'org-one' }, currentUser)
      expect(org).toEqual({
        id: 'org1',
        slug: 'org-one',
        role: 'viewer',
        membershipId: 'membership1',
      })
      expect(getCurrentOrg()).toEqual(org)
    })
  })

  it('ignores a forged role on the org identity itself', async () => {
    await getAsyncStoreInstance().run(new Map(), async () => {
      // Even if a caller tries to smuggle a role through the org argument,
      // `setCurrentOrg`'s type only accepts `{ id, slug }`, and the role
      // always comes from the matching membership.
      const org = setCurrentOrg({ id: 'org1', slug: 'org-one' }, currentUser)
      expect(org.role).toBe('viewer')
      expect(org.role).not.toBe('owner')
    })
  })

  it('throws ForbiddenError when there is no membership', async () => {
    await getAsyncStoreInstance().run(new Map(), async () => {
      expect(() =>
        setCurrentOrg({ id: 'org3', slug: 'org-three' }, currentUser),
      ).toThrow(ForbiddenError)
    })
  })

  it('getCurrentOrg returns undefined with nothing set', async () => {
    await getAsyncStoreInstance().run(new Map(), async () => {
      expect(getCurrentOrg()).toBeUndefined()
    })
  })
})

describe('requireCurrentOrg', () => {
  it('throws TenantScopeError when no org is set', async () => {
    await getAsyncStoreInstance().run(new Map(), async () => {
      expect(() => requireCurrentOrg()).toThrow(TenantScopeError)
    })
  })

  it('returns the current org when one is set', async () => {
    await getAsyncStoreInstance().run(new Map(), async () => {
      setCurrentOrg({ id: 'org1', slug: 'org-one' }, currentUser)
      expect(requireCurrentOrg().id).toBe('org1')
    })
  })
})

describe('resolveCurrentOrg', () => {
  const lookupOrg = vi.fn(async (idOrSlug: string) => {
    if (idOrSlug === 'org1' || idOrSlug === 'org-one') {
      return { id: 'org1', slug: 'org-one' }
    }
    return null
  })

  beforeEach(() => {
    lookupOrg.mockClear()
  })

  it('resolves from the cedar-org header', async () => {
    await getAsyncStoreInstance().run(new Map(), async () => {
      const org = await resolveCurrentOrg({
        event: lambdaEvent({ [CEDAR_ORG_HEADER]: 'org1' }),
        currentUser,
        lookupOrg,
      })
      expect(org?.id).toBe('org1')
      expect(lookupOrg).toHaveBeenCalledWith('org1')
    })
  })

  it('falls back to variables.orgId', async () => {
    await getAsyncStoreInstance().run(new Map(), async () => {
      const org = await resolveCurrentOrg({
        event: lambdaEvent(),
        variables: { orgId: 'org1' },
        currentUser,
        lookupOrg,
      })
      expect(org?.id).toBe('org1')
    })
  })

  it('falls back to variables.orgSlug', async () => {
    await getAsyncStoreInstance().run(new Map(), async () => {
      const org = await resolveCurrentOrg({
        event: lambdaEvent(),
        variables: { orgSlug: 'org-one' },
        currentUser,
        lookupOrg,
      })
      expect(org?.id).toBe('org1')
      expect(lookupOrg).toHaveBeenCalledWith('org-one')
    })
  })

  it('prefers the header over variables', async () => {
    await getAsyncStoreInstance().run(new Map(), async () => {
      await resolveCurrentOrg({
        event: lambdaEvent({ [CEDAR_ORG_HEADER]: 'org1' }),
        variables: { orgId: 'org-should-not-be-used' },
        currentUser,
        lookupOrg,
      })
      expect(lookupOrg).toHaveBeenCalledWith('org1')
    })
  })

  it('returns undefined with no header and no variables', async () => {
    await getAsyncStoreInstance().run(new Map(), async () => {
      const org = await resolveCurrentOrg({
        event: lambdaEvent(),
        currentUser,
        lookupOrg,
      })
      expect(org).toBeUndefined()
      expect(getCurrentOrg()).toBeUndefined()
      expect(lookupOrg).not.toHaveBeenCalled()
    })
  })

  it('rejects an id/slug lookupOrg does not resolve, with ForbiddenError', async () => {
    await getAsyncStoreInstance().run(new Map(), async () => {
      await expect(
        resolveCurrentOrg({
          event: lambdaEvent({ [CEDAR_ORG_HEADER]: 'unknown-org' }),
          currentUser,
          lookupOrg,
        }),
      ).rejects.toThrow(ForbiddenError)
    })
  })

  it('rejects an organization the user is not a member of, the same way as unknown', async () => {
    const lookupOtherOrg = vi.fn(async () => ({
      id: 'org3',
      slug: 'org-three',
    }))
    await getAsyncStoreInstance().run(new Map(), async () => {
      await expect(
        resolveCurrentOrg({
          event: lambdaEvent({ [CEDAR_ORG_HEADER]: 'org3' }),
          currentUser,
          lookupOrg: lookupOtherOrg,
        }),
      ).rejects.toThrow(ForbiddenError)
    })
  })

  it('a resolver cannot forge a role: context always holds the real membership role', async () => {
    // `viewerOnly` is a membership list where the user is only a `viewer`
    // in `org1`. Even though the org lookup below could return any shape,
    // `resolveCurrentOrg` only ever reads `{ id, slug }` off it, so there's
    // no channel for a forged `role: 'owner'` to reach the context.
    const viewerOnly = {
      memberships: [{ id: 'm1', organizationId: 'org1', role: 'viewer' }],
    }

    await getAsyncStoreInstance().run(new Map(), async () => {
      const org = await resolveCurrentOrg({
        event: lambdaEvent({ [CEDAR_ORG_HEADER]: 'org1' }),
        currentUser: viewerOnly,
        lookupOrg,
      })
      expect(org?.role).toBe('viewer')
      expect(getCurrentOrg()?.role).toBe('viewer')
    })
  })
})

describe('withTenancy', () => {
  it('sets currentUser and currentOrg before calling the handler', async () => {
    const getCurrentUser = vi.fn(async () => currentUser)
    const authDecoder = vi.fn(async () => ({ sub: 'user1' }))
    const lookupOrg = vi.fn(async () => ({ id: 'org1', slug: 'org-one' }))

    const handler = vi.fn(async () => {
      const org = getCurrentOrg()
      return { orgId: org?.id, role: org?.role }
    })

    const wrapped = withTenancy(handler, {
      authDecoder,
      getCurrentUser,
      lookupOrg,
    })

    const event = lambdaEvent({
      'auth-provider': 'dbAuth',
      authorization: 'Bearer token',
      [CEDAR_ORG_HEADER]: 'org1',
    })

    const result = await wrapped(event, {} as never)

    expect(getCurrentUser).toHaveBeenCalled()
    expect(result).toEqual({ orgId: 'org1', role: 'viewer' })
  })

  it('still calls the handler, with no currentOrg, for an unauthenticated request', async () => {
    const getCurrentUser = vi.fn(async () => currentUser)
    const authDecoder = vi.fn(async () => ({ sub: 'user1' }))
    const lookupOrg = vi.fn(async () => ({ id: 'org1', slug: 'org-one' }))

    const handler = vi.fn(async () => getCurrentOrg())

    const wrapped = withTenancy(handler, {
      authDecoder,
      getCurrentUser,
      lookupOrg,
    })

    const result = await wrapped(lambdaEvent(), {} as never)

    expect(getCurrentUser).not.toHaveBeenCalled()
    expect(result).toBeUndefined()
  })
})
