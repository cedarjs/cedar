import { describe, expect, it } from 'vitest'

import { createLogger } from '@cedarjs/api/logger'

import { createGraphQLYoga } from '../createGraphQLYoga.js'
import type { CedarGraphQLContext } from '../types.js'

const sdls = {
  greet: {
    schema: `
      type Query {
        greet(name: String!): String!
      }
    `,
  },
}

const services = {
  greet: { greet: ({ name }: { name: string }) => `hi ${name}` },
}

async function contextSeenBy(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  const seen: CedarGraphQLContext[] = []

  const { yoga } = await createGraphQLYoga({
    loggerConfig: { logger: createLogger({}) },
    // The SDL and service shapes here are the minimum a query needs, not the
    // full generated ones these options are typed for.
    sdls: sdls as never,
    services: services as never,
    context: async ({ context }: { context: CedarGraphQLContext }) => {
      seen.push(context)
      return {}
    },
  })

  const response = await yoga.fetch('http://localhost/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })

  return { context: seen[0], response }
}

// A `context` function runs after Yoga has parsed the request, so it can read
// the operation's variables and the request's headers. These tests pin the
// shape it reads them from.
describe('the context function argument', () => {
  it('carries the parsed operation variables', async () => {
    const { context, response } = await contextSeenBy({
      query: 'query G($name: String!) { greet(name: $name) }',
      variables: { name: 'ada' },
    })

    expect(await response.json()).toEqual({
      data: { greet: 'hi ada' },
      extensions: {},
    })
    expect(context.params.variables).toEqual({ name: 'ada' })
  })

  it('carries the request, so headers are readable', async () => {
    const { context } = await contextSeenBy(
      { query: '{ greet(name: "ada") }' },
      { 'cedar-org': 'org_1' },
    )

    expect(context.request?.headers.get('cedar-org')).toBe('org_1')
  })
})
