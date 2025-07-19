import { db } from '$api/src/lib/db.js'

export async function routeParameters() {
  return (await db.post.findMany({ take: 7 })).map((post) => ({ id: post.id }))
}
