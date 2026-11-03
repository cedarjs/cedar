import { posts } from 'src/services/posts/posts.js'

declare global {
  // Set by Cedar's vitest setup when a test file imports the database
  // eslint-disable-next-line no-var
  var __cedarjs_db_imported__: boolean | undefined
}

test('Cedar is correctly tracking db imports 2', async () => {
  const allPosts = await posts()
  expect(Array.isArray(allPosts)).toEqual(true)

  // Because we're importing the posts service, which uses the database, Cedar
  // should track that db import
  expect(globalThis.__cedarjs_db_imported__).toBeTruthy()
})
