import type { Decoded } from '@cedarjs/api'

import { db } from './db.js'

// A hand-rolled getCurrentUser with no `select`, so the codemod has nowhere
// safe to add `memberships`.
export const getCurrentUser = async (session: Decoded) => {
  const users = await db.$queryRaw`SELECT * FROM User WHERE id = ${session?.id}`

  return users[0]
}
