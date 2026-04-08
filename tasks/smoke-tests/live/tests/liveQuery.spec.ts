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
