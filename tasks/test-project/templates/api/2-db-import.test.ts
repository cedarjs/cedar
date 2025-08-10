import { posts } from 'src/services/posts/posts.js'

test('Cedar is correctly tracking db imports 2', async () => {
  const allPosts = await posts()
  expect(Array.isArray(allPosts)).toEqual(true)

  // Because we're importing the posts service, which uses the database, Cedar
  // should track that db import
  expect(globalThis.__cedarjs_db_imported__).toBeTruthy()
})
