import * as fs from 'node:fs'
import * as path from 'node:path'

import { test, expect } from '@playwright/test'
import execa from 'execa'

test('@live query updates when data changes', async ({ page }) => {
  await page.goto('/')

  await expect(
    page.getByText(
      'Meh waistcoat succulents umami asymmetrical, hoodie post-ironic paleo',
    ),
  ).toBeVisible()

  const testProjectPath = process.env.CEDAR_TEST_PROJECT_PATH

  const scriptPath = path.join(testProjectPath, 'scripts', 'updatePostTitle.ts')
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

  const testProjectPath = process.env.CEDAR_TEST_PROJECT_PATH

  const scriptPath = path.join(testProjectPath, 'scripts', 'createPost.ts')
  fs.writeFileSync(
    scriptPath,
    `\
    import { db } from 'api/src/lib/db.js'

    export default async () => {
      const post = await db.post.create({
        data: {
          title: 'Brand New Live Post',
          body: 'This was created during the test and should appear via @live.',
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
