import { test, expect } from '@playwright/test'
import type { Response } from '@playwright/test'

import { loginAsTestUser, signUpTestUser } from '../../shared/common.js'

interface GraphQLRequestBody {
  query?: string
}

const testUser = {
  email: 'testuser@bazinga.com',
  password: 'test123',
  fullName: 'Test User',
}

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage()

  await signUpTestUser({ page, ...testUser })

  await page.close()
})

test('login and auth state work with trusted documents enabled', async ({
  page,
}) => {
  const graphqlResponses: Response[] = []

  // Register the collector before logging in, since `useCurrentUser` fires
  // its (non-persisted, allow-listed) query as part of the login/redirect
  // flow.
  page.on('response', (res) => {
    if (res.request().method() === 'POST' && res.url().includes('/graphql')) {
      graphqlResponses.push(res)
    }
  })

  await loginAsTestUser({ page, ...testUser })

  await page.goto('/profile')

  const usernameRow = await page.waitForSelector('*css=tr >> text=EMAIL')
  expect(await usernameRow.innerHTML()).toBe(
    '<td>EMAIL</td><td>testuser@bazinga.com</td>',
  )

  const isAuthenticatedRow = await page.waitForSelector(
    '*css=tr >> text=isAuthenticated',
  )
  expect(await isAuthenticatedRow.innerHTML()).toBe(
    '<td>isAuthenticated</td><td>true</td>',
  )

  // #2458 regression: the `currentUser` query used to 500 every non-persisted
  // request, including this one, which broke login entirely.
  for (const res of graphqlResponses) {
    expect(res.status()).toBeLessThan(500)
  }

  const currentUserResponse = graphqlResponses.find((res) => {
    const body: GraphQLRequestBody = res.request().postDataJSON()
    return body.query?.includes('__CEDAR__AUTH_GET_CURRENT_USER')
  })

  expect(currentUserResponse).toBeDefined()
  expect(currentUserResponse?.status()).toBe(200)

  await page.goto('/')
  await page.getByText('Log Out').click()
  await expect(page.getByText('Log In')).toBeVisible()
})
