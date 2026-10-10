import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import Step2_1_PagesHome from './codemods/Step2_1_PagesHome.js'
import Step2_2_PagesAbout from './codemods/Step2_2_PagesAbout.js'
import Step3_1_LayoutsBlog from './codemods/Step3_1_LayoutsBlog.js'
import Step3_2_Routes from './codemods/Step3_2_Routes.js'
import Step3_3_PagesHome from './codemods/Step3_3_PagesHome.js'
import Step3_4_PagesAbout from './codemods/Step3_4_PagesAbout.js'
import Step4_1_DbSchema from './codemods/Step4_1_DbSchema.js'
import Step5_1_ComponentsCellBlogPost from './codemods/Step5_1_ComponentsCellBlogPost.js'
import Step5_2_ComponentsCellBlogPostTest from './codemods/Step5_2_ComponentsCellBlogPostTest.js'
import Step5_3_PagesHome from './codemods/Step5_3_PagesHome.js'
import Step6_1_Routes from './codemods/Step6_1_Routes.js'
import Step6_2_BlogPostPage from './codemods/Step6_2_BlogPostPage.js'
import Step6_3_BlogPostCell from './codemods/Step6_3_BlogPostCell.js'
import Step6_3_BlogPostCellTest from './codemods/Step6_3_BlogPostCellTest.js'
import Step6_4_BlogPost from './codemods/Step6_4_BlogPost.js'
import Step6_4_BlogPostTest from './codemods/Step6_4_BlogPostTest.js'
import Step6_5_BlogPostsCell from './codemods/Step6_5_BlogPostsCell.js'
import Step6_5_BlogPostsCellMock from './codemods/Step6_5_BlogPostsCellMock.js'
import Step7_1_BlogLayout from './codemods/Step7_1_BlogLayout.js'
import Step7_2_ContactPage from './codemods/Step7_2_ContactPage.js'
import Step7_3_Css from './codemods/Step7_3_Css.js'
import Step7_4_Routes from './codemods/Step7_4_Routes.js'
import Step8_1_ContactPageWithoutJsEmailValidation from './codemods/Step8_1_ContactPageWithoutJsEmailValidation.js'
import Step8_2_CreateContactServiceValidation from './codemods/Step8_2_CreateContactServiceValidation.js'
import Step8_3_UpdateContactTest from './codemods/Step8_3_UpdateContactTest.js'
import {
  cedar,
  expectAfterUpdate,
  gotoWhenReady,
  removeProjectPath,
  waitForApiSide,
  waitForGraphQL,
  writeProjectFile,
} from './helpers.ts'

// Follows the tutorial (https://cedarjs.com/docs/tutorial) against a freshly
// created JavaScript app while its dev server is running. Each step runs
// generators and writes files, then checks that the web side hot-reloads and
// that the API side restarts and serves the new code.

test.describe.configure({ mode: 'serial' })

test.describe('The Cedar Tutorial - Golden path edition', () => {
  // All steps share one page, so that a step can check how the page that is
  // already open reacts to the changes it makes
  let page: Page

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage()

    // Uncaught errors in the app don't fail the test on their own (the steps
    // wait for the expected content instead), but they're useful context
    // when a step fails
    page.on('pageerror', (error) => {
      console.warn(`[pageerror] ${page.url()}: ${error.message}`)
    })
  })

  test.afterAll(async () => {
    await page.close()
  })

  test('0. Starting Development', async ({ request }) => {
    // https://cedarjs.com/docs/tutorial/chapter1/installation
    await waitForApiSide(request)

    await gotoWhenReady(page, '/', async () => {
      await expect(
        page.locator('h1').filter({ hasText: 'Welcome to' }),
      ).toBeVisible()
    })
  })

  test('1. Our First Page', async () => {
    // https://cedarjs.com/docs/tutorial/chapter1/first-page
    await page.goto('/')
    cedar('generate page home / --force')

    await expectAfterUpdate(page, async () => {
      await expect(
        page.locator('h1').filter({ hasText: 'HomePage' }),
      ).toBeVisible()
    })
  })

  test('2. A Second Page and a Link', async () => {
    // https://cedarjs.com/docs/tutorial/chapter1/second-page
    cedar('generate page about --force')
    writeProjectFile('web/src/pages/HomePage/HomePage.jsx', Step2_1_PagesHome)

    const aboutLink = page.getByRole('link', { name: 'About', exact: true })
    await expectAfterUpdate(page, async () => {
      await expect(aboutLink).toBeVisible()
    })
    await aboutLink.click()

    await expectAfterUpdate(page, async () => {
      await expect(
        page.locator('h1').filter({ hasText: 'AboutPage' }),
      ).toBeVisible()
    })

    writeProjectFile(
      'web/src/pages/AboutPage/AboutPage.jsx',
      Step2_2_PagesAbout,
    )

    await expectAfterUpdate(page, async () => {
      await expect(
        page.locator('h1').filter({ hasText: 'Cedar Blog' }),
      ).toBeVisible()
    })
    await page.getByRole('link', { name: 'Return home' }).click()
    await expect(page).toHaveURL('/')
  })

  test('3. Layouts', async () => {
    // https://cedarjs.com/docs/tutorial/chapter1/layouts
    cedar('generate layout blog --force')
    writeProjectFile(
      'web/src/layouts/BlogLayout/BlogLayout.jsx',
      Step3_1_LayoutsBlog,
    )
    writeProjectFile('web/src/Routes.jsx', Step3_2_Routes)
    writeProjectFile('web/src/pages/HomePage/HomePage.jsx', Step3_3_PagesHome)

    const homeLink = page.getByRole('link', { name: 'Cedar Blog' })
    await expectAfterUpdate(page, async () => {
      await expect(homeLink).toBeVisible()
    })
    await homeLink.click()
    await expect(page.locator('main')).toContainText('Home')

    writeProjectFile(
      'web/src/pages/AboutPage/AboutPage.jsx',
      Step3_4_PagesAbout,
    )

    await page.getByRole('link', { name: 'About', exact: true }).click()

    await expectAfterUpdate(page, async () => {
      await expect(
        page.locator('p').filter({
          hasText:
            'This site was created to demonstrate my mastery of Cedar: Look on my works, ye mighty, and despair!',
        }),
      ).toBeVisible()
    })
  })

  test('4. Getting Dynamic', async ({ request }) => {
    // https://cedarjs.com/docs/tutorial/chapter2/getting-dynamic
    writeProjectFile('api/db/schema.prisma', Step4_1_DbSchema)

    // Start from an empty database and no migrations, so the Prisma Client
    // can't be out of sync with the schema
    removeProjectPath('api/db/dev.db')
    removeProjectPath('api/db/migrations')
    cedar('prisma migrate reset --force')
    cedar('prisma migrate dev --name setup')
    cedar('prisma generate')
    cedar('g scaffold post --force')

    // Only an API side that has restarted with the new SDL can answer this
    await waitForGraphQL(request, '{ posts { id } }')

    // The scaffold generator rewrites Routes.jsx, so the first page load can
    // land while Vite is still processing it
    await gotoWhenReady(page, '/posts', async () => {
      await expect(
        page.locator('h1').filter({ hasText: 'Posts' }),
      ).toBeVisible()
    })

    // Scaffold CSS
    await expect(page.locator('a.rw-button.rw-button-green')).toHaveCSS(
      'background-color',
      'rgb(72, 187, 120)',
    )

    await page.getByRole('link', { name: 'New Post' }).click()
    await expect(
      page.locator('h2').filter({ hasText: 'New Post' }),
    ).toBeVisible()

    // SAVE
    await page.locator('input#title').fill('First post')
    await page.locator('input#body').fill('Hello world!')
    await expect(page.locator('button.rw-button.rw-button-blue')).toHaveCSS(
      'background-color',
      'rgb(49, 130, 206)',
    )
    await page.getByRole('button', { name: 'Save' }).click()

    // Toast message
    await expect(
      page.locator('div[role="status"]').filter({ hasText: 'Post created' }),
    ).toBeVisible()
    await expect(page.getByText('Loading...')).toHaveCount(0)

    // EDIT
    await page.getByRole('link', { name: 'Edit', exact: true }).click()
    await expect(page.getByText('Loading...')).toHaveCount(0)
    await expect(
      page.locator('h2').filter({ hasText: 'Edit Post 1' }),
    ).toBeVisible()
    await page.locator('input#body').fill('No, Margle the World!')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(
      page.getByRole('cell', { name: 'No, Margle the World!' }),
    ).toBeVisible()
    await expect(
      page.locator('div[role="status"]').filter({ hasText: 'Post updated' }),
    ).toBeVisible()

    // DELETE
    // The scaffold asks for confirmation before deleting
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'Delete', exact: true }).click()

    // No more posts, so the list shows its empty state
    await expect(
      page.locator('div[role="status"]').filter({ hasText: 'Post deleted' }),
    ).toBeVisible()

    await page.getByRole('link', { name: 'Create one?' }).click()
    await page.locator('input#title').fill('Second post')
    await page.locator('input#body').fill('Hello world!')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('cell', { name: 'Second post' })).toBeVisible()
  })

  test('5. Cells', async () => {
    // https://cedarjs.com/docs/tutorial/chapter2/cells
    cedar('g cell BlogPosts --force')
    writeProjectFile(
      'web/src/components/BlogPostsCell/BlogPostsCell.jsx',
      Step5_1_ComponentsCellBlogPost,
    )
    writeProjectFile(
      'web/src/components/BlogPostsCell/BlogPostsCell.test.jsx',
      Step5_2_ComponentsCellBlogPostTest,
    )
    writeProjectFile('web/src/pages/HomePage/HomePage.jsx', Step5_3_PagesHome)

    await gotoWhenReady(page, '/', async () => {
      // [{"id":2,"title":"Second post","body":"Hello world!","__typename":"Post"}]
      await expect(page.locator('main')).toContainText('"body":"Hello world!"')
    })
  })

  test('6. Routing Params', async ({ request }) => {
    // https://cedarjs.com/docs/tutorial/chapter2/routing-params
    cedar('g page BlogPost --force')
    cedar('g cell BlogPost --force')
    cedar('g component BlogPost --force')

    writeProjectFile('web/src/Routes.jsx', Step6_1_Routes)
    writeProjectFile(
      'web/src/pages/BlogPostPage/BlogPostPage.jsx',
      Step6_2_BlogPostPage,
    )
    writeProjectFile(
      'web/src/components/BlogPostCell/BlogPostCell.jsx',
      Step6_3_BlogPostCell,
    )
    writeProjectFile(
      'web/src/components/BlogPostCell/BlogPostCell.test.jsx',
      Step6_3_BlogPostCellTest,
    )
    writeProjectFile(
      'web/src/components/BlogPost/BlogPost.jsx',
      Step6_4_BlogPost,
    )
    writeProjectFile(
      'web/src/components/BlogPost/BlogPost.test.jsx',
      Step6_4_BlogPostTest,
    )
    writeProjectFile(
      'web/src/components/BlogPostsCell/BlogPostsCell.jsx',
      Step6_5_BlogPostsCell,
    )
    writeProjectFile(
      'web/src/components/BlogPostsCell/BlogPostsCell.mock.js',
      Step6_5_BlogPostsCellMock,
    )

    await waitForApiSide(request)

    const newPostLink = page.getByRole('link', { name: 'New Post' })
    await gotoWhenReady(page, '/posts', async () => {
      await expect(newPostLink).toBeVisible()
    })

    // New entry
    await newPostLink.click()
    await page.locator('input#title').fill('Third post')
    await page.locator('input#body').fill('foo bar')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('cell', { name: 'Third post' })).toBeVisible()

    // Detail pages
    const secondPostLink = page.getByRole('link', { name: 'Second post' })
    await gotoWhenReady(page, '/', async () => {
      await expect(secondPostLink).toBeVisible()
    })
    await secondPostLink.click()
    await expect(page).toHaveURL(/\/blog-post\/\d+$/)
    await expect(page.locator('main')).toContainText('Hello world!')

    const thirdPostLink = page.getByRole('link', { name: 'Third post' })
    await gotoWhenReady(page, '/', async () => {
      await expect(thirdPostLink).toBeVisible()
    })
    await thirdPostLink.click()
    await expect(page).toHaveURL(/\/blog-post\/\d+$/)
    await expect(page.locator('main')).toContainText('foo bar')
  })

  test("7. Everyone's Favorite Thing to Build: Forms", async () => {
    // https://cedarjs.com/docs/tutorial/chapter3/forms
    cedar('g page contact --force')
    writeProjectFile(
      'web/src/layouts/BlogLayout/BlogLayout.jsx',
      Step7_1_BlogLayout,
    )
    writeProjectFile(
      'web/src/pages/ContactPage/ContactPage.jsx',
      Step7_2_ContactPage,
    )
    writeProjectFile('web/src/index.css', Step7_3_Css)
    writeProjectFile('web/src/Routes.jsx', Step7_4_Routes)

    const contactLink = page.getByRole('link', { name: 'Contact' })
    await expectAfterUpdate(page, async () => {
      await expect(contactLink).toBeVisible()
    })
    await contactLink.click()

    const saveButton = page.getByRole('button', { name: 'Save' })
    await expectAfterUpdate(page, async () => {
      await expect(saveButton).toBeVisible()
    })

    // Client-side validation
    await saveButton.click()
    const main = page.locator('main')
    await expect(main).toContainText('name is required')
    await expect(main).toContainText('email is required')
    await expect(main).toContainText('message is required')

    await page.locator('input#email').fill('foo bar')
    await saveButton.click()
    await expect(main).toContainText('Please enter a valid email address')

    await page.locator('input#name').fill('test name')
    await page.locator('input#email').fill('foo@bar.com')
    await page.locator('textarea#message').fill('test message')

    // The tutorial's `onSubmit` logs the form data
    const submitted = page.waitForEvent('console', {
      predicate: async (msg) => {
        const value = await msg
          .args()[0]
          ?.jsonValue()
          .catch(() => undefined)

        return typeof value === 'object' && value !== null && 'message' in value
      },
    })
    await saveButton.click()
    const message = await submitted
    expect(await message.args()[0].jsonValue()).toEqual({
      name: 'test name',
      email: 'foo@bar.com',
      message: 'test message',
    })
  })

  test('8. Saving Data', async ({ request }) => {
    // https://cedarjs.com/docs/tutorial/chapter3/saving-data
    cedar('g sdl contact --force --crud')

    writeProjectFile(
      'web/src/pages/ContactPage/ContactPage.jsx',
      Step8_1_ContactPageWithoutJsEmailValidation,
    )
    writeProjectFile(
      'api/src/services/contacts/contacts.js',
      Step8_2_CreateContactServiceValidation,
    )
    writeProjectFile(
      'api/src/services/contacts/contacts.test.js',
      Step8_3_UpdateContactTest,
    )

    // Only an API side that has restarted with the validating contacts
    // service rejects this input
    await waitForGraphQL(
      request,
      'mutation { createContact(input: { name: "e2e", email: "not an email", message: "e2e" }) { id } }',
      (body) => body.errors?.[0]?.message === "Can't create new contact",
    )

    const contactLink = page.getByRole('link', { name: 'Contact' })
    await gotoWhenReady(page, '/', async () => {
      await expect(contactLink).toBeVisible()
    })
    await contactLink.click()

    // Service-side validation
    await page.locator('input#name').fill('test name')
    await page.locator('input#email').fill('foo bar com')
    await page.locator('textarea#message').fill('test message')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(
      page.getByText("Can't create new contact").first(),
    ).toBeVisible()

    // Saving with a valid email
    await page.locator('input#email').fill('test@example.com')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Thank you for your submission')).toBeVisible()
  })
})
