import fs from 'node:fs'
import path from 'node:path'

import { test, expect } from '@playwright/test'
import execa from 'execa'

const testProjectPath = process.env.CEDAR_TEST_PROJECT_PATH

test.describe('@live', () => {
  test.afterAll(async () => {
    await execa('yarn', ['cedar', 'exec', 'resetPostTitle'], {
      cwd: testProjectPath,
      stdio: 'pipe',
    })
  })

  test('@live query updates when data changes', async ({ page }) => {
    await page.goto('/')

    await expect(
      page.getByText(
        'Meh waistcoat succulents umami asymmetrical, hoodie post-ironic paleo',
      ),
    ).toBeVisible()

    const scriptPath = path.join(
      testProjectPath,
      'scripts',
      'updatePostTitle.ts',
    )
    fs.writeFileSync(
      scriptPath,
      `\
      import { db } from 'api/src/lib/db.js'

      export default async () => {
        const post = await db.post.update({
          where: { id: 1 },
          data: { title: 'Live Updated Title' },
        })
        console.log('Updated post:', post.title)
      }
      `,
    )

    await execa('yarn', ['cedar', 'exec', 'updatePostTitle'], {
      cwd: testProjectPath,
      stdio: 'pipe',
    })

    await expect(page.getByText('Live Updated Title')).toBeVisible({
      timeout: 10_000,
    })

    fs.unlinkSync(scriptPath)
  })

  test('@live query reflects newly created records', async ({ page }) => {
    await page.goto('/')

    await expect(
      page.getByText(
        'Meh waistcoat succulents umami asymmetrical, hoodie post-ironic paleo',
      ),
    ).toBeVisible()

    const scriptPath = path.join(testProjectPath, 'scripts', 'createPost.ts')
    fs.writeFileSync(
      scriptPath,
      `\
      import { db } from 'api/src/lib/db.js'

      export default async () => {
        const post = await db.post.create({
          data: {
            title: 'Brand New Live Post',
            body: 'This post was created during the test and should appear ' +
              'via @live.',
            authorId: '4c3d3e8e-2b1a-4f5c-8c7d-9e0f1a2b3c4d',
          },
        })
        console.log('Created post:', post.title)
      }
      `,
    )

    await execa('yarn', ['cedar', 'exec', 'createPost'], {
      cwd: testProjectPath,
      stdio: 'pipe',
    })

    await expect(page.getByText('Brand New Live Post')).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByText('should appear via @live')).toBeVisible()

    fs.unlinkSync(scriptPath)
  })
})

test('useLiveQuery hook renders posts', async ({ page }) => {
  await page.goto('/live-query')

  await expect(page.getByText('Loading')).not.toBeVisible()

  await expect(
    page.getByText(
      'Meh waistcoat succulents umami asymmetrical, hoodie post-ironic paleo',
    ),
  ).toBeVisible()
})

test('useLiveQuery schema-aware selection: post body field is rendered', async ({
  page,
}) => {
  // This test verifies that the generated gqlorm-schema.json causes
  // useLiveQuery to request the `body` field in addition to `id`. If only
  // `id` were selected (the id-only fallback), the body text would not be
  // returned by the GraphQL server and this assertion would fail.
  await page.goto('/live-query')

  await expect(page.getByText('Loading')).not.toBeVisible()

  await expect(page.getByText('hoodie post-ironic paleo')).toBeVisible()
})

test('useLiveQuery schema-aware selection: post createdAt field is rendered', async ({
  page,
}) => {
  // This test verifies that `createdAt` — a field that is included in the
  // auto-generated gqlorm-schema.json — is fetched and displayed. The
  // LivePosts component renders a <time data-testid="post-created-at"> element.
  // If the schema did not include `createdAt`, the element would be empty or
  // missing, and this assertion would fail.
  await page.goto('/live-query')

  await expect(page.getByText('Loading')).not.toBeVisible()

  const createdAtEl = page.getByTestId('post-created-at').first()

  await expect(createdAtEl).toBeVisible()
  await expect(createdAtEl).not.toBeEmpty()
})

test('useLiveQuery hook updates when data changes', async ({ page }) => {
  await page.goto('/live-query')

  await expect(page.getByText('Loading')).not.toBeVisible()

  await expect(
    page.getByText(
      'Meh waistcoat succulents umami asymmetrical, hoodie post-ironic paleo',
    ),
  ).toBeVisible()

  const scriptPath = path.join(
    testProjectPath,
    'scripts',
    'updatePostTitleLiveHook.ts',
  )
  fs.writeFileSync(
    scriptPath,
    `\
    import { Pool } from 'pg'

    export default async () => {
      const pool = new Pool({ connectionString: process.env.DATABASE_URL })
      const result = await pool.query(
        "UPDATE \\"Post\\" SET title = 'Live Hook Updated Title' " +
        "WHERE id = 1 RETURNING title",
      )
      console.log('Updated post:', result.rows[0].title)
      await pool.end()
    }
    `,
  )

  await execa('yarn', ['cedar', 'exec', 'updatePostTitleLiveHook'], {
    cwd: testProjectPath,
    stdio: 'pipe',
  })

  await expect(page.getByText('Live Hook Updated Title')).toBeVisible({
    timeout: 10_000,
  })

  fs.unlinkSync(scriptPath)

  await execa('yarn', ['cedar', 'exec', 'resetPostTitleLiveHook'], {
    cwd: testProjectPath,
    stdio: 'pipe',
  })
})

test('useLiveQuery hook reflects newly created records', async ({ page }) => {
  await page.goto('/live-query')

  await expect(page.getByText('Loading')).not.toBeVisible()

  const scriptPath = path.join(
    testProjectPath,
    'scripts',
    'createPostLiveHook.ts',
  )
  fs.writeFileSync(
    scriptPath,
    `\
    import { Pool } from 'pg'

    export default async () => {
      const pool = new Pool({ connectionString: process.env.DATABASE_URL })
      const result = await pool.query(
        'INSERT INTO "Post" (title, body, "authorId", "createdAt") ' +
        "VALUES ('New Live Hook Post', 'Created during useLiveQuery test.', " +
        "'4c3d3e8e-2b1a-4f5c-8c7d-9e0f1a2b3c4d', NOW()) RETURNING title",
      )
      console.log('Created post:', result.rows[0].title)
      await pool.end()
    }
    `,
  )

  await execa('yarn', ['cedar', 'exec', 'createPostLiveHook'], {
    cwd: testProjectPath,
    stdio: 'pipe',
  })

  await expect(page.getByText('New Live Hook Post')).toBeVisible({
    timeout: 10_000,
  })
  await expect(page.getByText('Created during useLiveQuery test')).toBeVisible()

  fs.unlinkSync(scriptPath)
})

test.describe('gqlorm auto-generated backend', () => {
  test('todo list renders', async ({ page }) => {
    // This test verifies the full gqlorm backend pipeline: the Todo model has
    // no manually-written SDL or service file. The codegen generates
    // __gqlorm__.sdl.ts which provides the GraphQL type and query resolvers.
    // useLiveQuery((db) => db.todo.findMany()) on the frontend generates a
    // query against the auto-generated `todos` field.
    await page.goto('/gqlorm-todos')

    await expect(page.getByText('Loading')).not.toBeVisible({ timeout: 10_000 })

    // Verify seeded todo items are rendered
    await expect(page.getByText('Learn Cedar')).toBeVisible()
    await expect(page.getByText('Try gqlorm')).toBeVisible()
    await expect(page.getByText('Write tests')).toBeVisible()
  })

  test('todo fields are present', async ({ page }) => {
    // Verify that all scalar fields are fetched and rendered, not just `id`.
    // The LiveTodos component renders body, done status, and createdAt for
    // each todo. If the auto-generated backend didn't select these fields,
    // the elements would be empty or missing.
    await page.goto('/gqlorm-todos')

    await expect(page.getByText('Loading')).not.toBeVisible({ timeout: 10_000 })

    // body field
    await expect(
      page.getByText('Read the docs and try building a small app.'),
    ).toBeVisible()
    await expect(
      page.getByText('Auto-generated backend resolvers are pretty neat!'),
    ).toBeVisible()

    // done field — rendered as "Done" or "Pending" badges
    const doneEls = page.getByTestId('todo-done')
    await expect(doneEls.first()).toBeVisible()
    const allDoneTexts = await doneEls.allTextContents()
    expect(allDoneTexts).toContain('Done')
    expect(allDoneTexts).toContain('Pending')

    // createdAt field
    const createdAtEl = page.getByTestId('todo-created-at').first()
    await expect(createdAtEl).toBeVisible()
    await expect(createdAtEl).not.toBeEmpty()
  })
})
