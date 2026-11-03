import type {
  QueryResolvers,
  MutationResolvers,
  PostRelationResolvers,
} from 'types/graphql'

import { validateUniqueness } from '@cedarjs/api'

import { db } from 'src/lib/db'

export const posts: QueryResolvers['posts'] = () => {
  return db.post.findMany()
}

export const post: QueryResolvers['post'] = ({ id }) => {
  return db.post.findUnique({
    where: { id },
  })
}

export const createPost: MutationResolvers['createPost'] = ({ input }) => {
  return validateUniqueness(
    'post',
    { title: input.title },
    { db, message: 'A post with this title already exists.' },
    (db) => db.post.create({ data: input })
  )
}

export const updatePost: MutationResolvers['updatePost'] = ({ id, input }) => {
  return db.post.update({
    data: {
      ...input,
      // Every field in the GraphQL input is nullable, but Prisma doesn't
      // accept null for required fields. undefined leaves the field unchanged
      title: input.title ?? undefined,
      body: input.body ?? undefined,
      authorId: input.authorId ?? undefined,
    },
    where: { id },
  })
}

export const deletePost: MutationResolvers['deletePost'] = ({ id }) => {
  return db.post.delete({
    where: { id },
  })
}

export const Post: PostRelationResolvers = {
  author: (_obj, { root }) => {
    return db.post.findUniqueOrThrow({ where: { id: root.id } }).author()
  },
}
