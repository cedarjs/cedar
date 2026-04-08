import { db } from 'api/src/lib/db.js'

export default async () => {
  const post = await db.post.update({
    where: { id: 1 },
    data: { title: 'Welcome to the blog!' },
  })
  console.log('Reset post:', post.title)
}
