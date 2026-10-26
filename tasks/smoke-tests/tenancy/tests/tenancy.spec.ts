import type { Browser, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

import { loginAsTestUser, signUpTestUser } from '../../shared/common.js'

// Runs against a test project that `yarn e2e:tenancy` has set up: tenancy,
// plus an organizations page (/orgs) and an organization's page under
// OrgScope (/org/{orgSlug}). Each run signs up new users, so it can run
// again against the same database.
const run = Date.now()
const owner = { email: `tenancy-owner-${run}@example.com`, fullName: 'Owner' }
const other = { email: `tenancy-other-${run}@example.com`, fullName: 'Other' }

let ownerOrgPath = ''

test.describe.configure({ mode: 'serial' })

async function signedInPage(
  browser: Browser,
  user: { email: string; fullName: string },
): Promise<Page> {
  const context = await browser.newContext()
  const page = await context.newPage()

  await signUpTestUser({ page, ...user, password: 'test123' })

  return page
}

test('signing up creates an organization the user owns', async ({
  browser,
}) => {
  const page = await signedInPage(browser, owner)

  await page.goto('/orgs')
  await page.getByRole('link', { name: 'My Organization' }).click()
  await page.waitForURL(/\/org\/[^/]+$/)
  ownerOrgPath = new URL(page.url()).pathname

  // The name comes from the api, through @requirePermission, so the
  // request carried this organization
  await expect(
    page.getByRole('heading', { name: 'My Organization' }),
  ).toBeVisible()
  await expect(page.getByText('Role: owner')).toBeVisible()
  await expect(page.getByText('Can manage members: yes')).toBeVisible()

  await page.context().close()
})

test("another user can't open someone else's organization", async ({
  browser,
}) => {
  const page = await signedInPage(browser, other)

  await page.goto(ownerOrgPath)

  await expect(
    page.getByText("You don't have access to this organization."),
  ).toBeVisible()
  await expect(page.getByText('Can manage members')).not.toBeVisible()

  await page.context().close()
})

test("an invited member gets a member's permissions", async ({ browser }) => {
  const ownerPage = await browser.newPage()

  await loginAsTestUser({
    page: ownerPage,
    email: owner.email,
    password: 'test123',
  })

  await ownerPage.goto(ownerOrgPath)
  await ownerPage.getByLabel('Email').fill(other.email)
  await ownerPage.getByRole('button', { name: 'Invite' }).click()

  const invitationPath = await ownerPage
    .getByRole('link', { name: 'Invitation link' })
    .getAttribute('href')

  expect(invitationPath).toMatch(/^\/invite\//)

  await ownerPage.context().close()

  const memberPage = await browser.newPage()

  await loginAsTestUser({
    page: memberPage,
    email: other.email,
    password: 'test123',
  })

  // InvitePage accepts the invitation and goes to the organization
  await memberPage.goto(invitationPath!)
  await memberPage.waitForURL(ownerOrgPath)

  await expect(
    memberPage.getByRole('heading', { name: 'My Organization' }),
  ).toBeVisible()
  await expect(memberPage.getByText('Role: member')).toBeVisible()
  await expect(memberPage.getByText('Can manage members: no')).toBeVisible()
  await expect(
    memberPage.getByRole('button', { name: 'Invite' }),
  ).not.toBeVisible()

  await memberPage.context().close()
})
