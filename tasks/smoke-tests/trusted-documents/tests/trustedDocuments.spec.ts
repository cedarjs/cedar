import { test, expect } from '@playwright/test'
import type { Request, Response } from '@playwright/test'

interface GraphQLRequestBody {
  query?: string
  extensions?: {
    persistedQuery?: {
      version?: number
      sha256Hash?: string
    }
  }
}

interface GraphQLResponseBody {
  data?: unknown
  errors?: { message?: string }[]
}

// The exact query the auth package sends for `useCurrentUser`. Trusted
// Documents special-cases this one query so login keeps working even though
// it isn't a persisted operation.
const AUTH_CURRENT_USER_QUERY =
  'query __CEDAR__AUTH_GET_CURRENT_USER { cedar { currentUser } }'

// The test project sets `apiUrl = "/.api/functions"` in cedar.toml, so this
// is where the GraphQL function is served
const GRAPHQL_ENDPOINT = '/.api/functions/graphql'

const isGraphQLPostRequest = (req: Request) =>
  req.method() === 'POST' && req.url().includes('/graphql')

const isGraphQLPostResponse = (res: Response) =>
  isGraphQLPostRequest(res.request())

test('app loads data using persisted documents', async ({ page }) => {
  const graphqlRequests: Request[] = []
  const graphqlResponses: Response[] = []

  // Register collectors before navigating so we don't miss the requests the
  // home page fires while hydrating.
  page.on('request', (req) => {
    if (isGraphQLPostRequest(req)) {
      graphqlRequests.push(req)
    }
  })
  page.on('response', (res) => {
    if (isGraphQLPostResponse(res)) {
      graphqlResponses.push(res)
    }
  })

  // Start waiting before navigating — the home page can fire and finish its
  // GraphQL request before `goto` resolves, and `waitForResponse` only
  // observes future responses.
  const firstGraphQLResponse = page.waitForResponse(isGraphQLPostResponse)
  await page.goto('/')
  await firstGraphQLResponse

  // The home page is prerendered, so visible text alone doesn't prove
  // GraphQL executed. The request/response assertions below do that; this
  // just confirms the data actually rendered.
  await expect(
    page.getByText(
      'Meh waistcoat succulents umami asymmetrical, hoodie post-ironic paleo chillwave ',
    ),
  ).toBeVisible()

  expect(graphqlRequests.length).toBeGreaterThan(0)

  for (const req of graphqlRequests) {
    const body: GraphQLRequestBody = req.postDataJSON()
    const sha256Hash = body.extensions?.persistedQuery?.sha256Hash
    const isPersisted =
      typeof sha256Hash === 'string' &&
      sha256Hash.length > 0 &&
      body.query === undefined
    const isAllowedAuthQuery = body.query === AUTH_CURRENT_USER_QUERY

    expect(isPersisted || isAllowedAuthQuery).toBe(true)
  }

  expect(graphqlResponses.length).toBeGreaterThan(0)

  let sawSuccessfulData = false
  for (const res of graphqlResponses) {
    expect(res.status()).toBe(200)

    const body: GraphQLResponseBody = await res.json()
    if (body.data && !body.errors) {
      sawSuccessfulData = true
    }
  }

  expect(sawSuccessfulData).toBe(true)
})

test('arbitrary operations are rejected without a 500', async ({ request }) => {
  const response = await request.post(GRAPHQL_ENDPOINT, {
    data: { query: '{ __typename }' },
    headers: { 'content-type': 'application/json' },
  })

  // This is the core #2458 regression assertion: arbitrary operations used
  // to 500 with `TypeError: Body is unusable` instead of a clean rejection.
  expect(response.status()).toBeLessThan(500)

  const body: GraphQLResponseBody = await response.json()
  expect(body.errors?.[0]?.message).toBe('Use Trusted Only!')
  expect(body.data).toBeFalsy()
})

test('auth currentUser query without auth headers is rejected', async ({
  request,
}) => {
  const response = await request.post(GRAPHQL_ENDPOINT, {
    data: { query: AUTH_CURRENT_USER_QUERY },
    headers: { 'content-type': 'application/json' },
  })

  expect(response.status()).toBeLessThan(500)

  const body: GraphQLResponseBody = await response.json()
  expect(body.errors?.[0]?.message).toBe('Use Trusted Only!')
})

test('unknown persisted operation hash gets a clean error', async ({
  request,
}) => {
  const response = await request.post(GRAPHQL_ENDPOINT, {
    data: {
      extensions: {
        persistedQuery: {
          version: 1,
          sha256Hash:
            'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        },
      },
    },
    headers: { 'content-type': 'application/json' },
  })

  expect(response.status()).toBeLessThan(500)

  const body: GraphQLResponseBody = await response.json()
  expect(body.errors?.[0]?.message).toBeTruthy()
  expect(body.data).toBeFalsy()
})

// Runs last (Playwright executes tests within a file in declaration order),
// after the rejected requests above, to guard against the server being left
// wedged or crashed by them.
test('server keeps serving persisted operations after rejecting arbitrary ones', async ({
  page,
}) => {
  const graphQLResponse = page.waitForResponse(isGraphQLPostResponse)
  await page.goto('/')
  const response = await graphQLResponse

  expect(response.status()).toBe(200)
})
