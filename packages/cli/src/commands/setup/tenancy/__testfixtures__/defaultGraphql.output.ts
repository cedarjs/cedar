import { createAuthDecoder } from '@cedarjs/auth-dbauth-api'
import { createGraphQLHandler } from '@cedarjs/graphql-server'

import directives from 'src/directives/**/*.{js,ts}'
import sdls from 'src/graphql/**/*.sdl.{js,ts}'
import services from 'src/services/**/*.{js,ts}'

import { cookieName, getCurrentUser } from 'src/lib/auth'
import { db } from 'src/lib/db'
import { logger } from 'src/lib/logger'

import { isUserWithMemberships, resolveCurrentOrg } from '@cedarjs/tenancy'

const authDecoder = createAuthDecoder(cookieName)

export const handler = createGraphQLHandler({
  authDecoder,
  getCurrentUser,
  loggerConfig: { logger, options: {} },
  directives,
  sdls,
  services,

  onException: () => {
    // Disconnect from your database with an unhandled exception.
    db.$disconnect()
  },

  context: async ({ context: gqlContext }) => {
    const { currentUser, event, request, params } = gqlContext

    // A user whose getCurrentUser result doesn't carry memberships
    // can't be matched to an organization, so the request runs with
    // no current organization set.
    if (!isUserWithMemberships(currentUser)) {
      return {}
    }

    // Yoga can populate either `event` (Lambda-style deployments) or
    // `request` (Fetch-API-style deployments); resolveCurrentOrg reads
    // the organization header off either.
    const requestEvent = event ?? request

    if (!requestEvent) {
      return {}
    }

    const currentOrg = await resolveCurrentOrg({
      event: requestEvent,
      variables: params.variables,
      currentUser,
      lookupOrg: (idOrSlug) =>
        db.organization.findFirst({
          where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
          select: { id: true, slug: true },
        }),
    })

    return { currentOrg }
  },
})
