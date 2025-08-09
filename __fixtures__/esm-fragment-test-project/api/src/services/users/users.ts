import type { QueryResolvers, UserRelationResolvers } from 'types/graphql.js'

import { db } from 'src/lib/db.js'

export {}

export const user: QueryResolvers['user'] = ({ id }) => {
  return db.user.findUnique({
    where: { id },
  })
}

export const User: UserRelationResolvers = {
  posts: (_obj, { root }) => {
    return db.user.findUnique({ where: { id: root?.id } }).posts()
  },
}
