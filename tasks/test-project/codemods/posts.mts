import fs from 'node:fs'

export async function addValidateUniquenessToPosts(postsServicePath: string) {
  const content = await fs.promises.readFile(postsServicePath, 'utf-8')

  const updatedContent = content.replace(
    /} from 'types\/graphql'/,
    `} from 'types/graphql'\n\nimport { validateUniqueness } from '@cedarjs/api'`,
  )

  // Update the `createPost` mutation to use `validateUniqueness`.
  // Change it from
  //
  // export const createPost: MutationResolvers['createPost'] = ({ input }) => {
  //   return db.post.create({
  //     data: input,
  //   })
  // }
  //
  // to
  //
  // export const createPost: MutationResolvers['createPost'] = ({ input }) => {
  //   return validateUniqueness(
  //     'post',
  //     { title: input.title },
  //     { db, message: 'A post with this title already exists.' },
  //     (db) => db.post.create({ data: input })
  //   )
  // }
  const contentLines = updatedContent.split('\n')
  const createPostStart = contentLines.findIndex((line) =>
    line.startsWith("export const createPost: MutationResolvers['createPost']"),
  )
  const createPostEnd = contentLines.findIndex(
    (line, i) => i > createPostStart && line.startsWith('}'),
  )
  contentLines.splice(
    createPostStart + 1,
    createPostEnd - createPostStart - 1,
    '  return validateUniqueness(',
    "    'post',",
    '    { title: input.title },',
    "    { db, message: 'A post with this title already exists.' },",
    '    (db) => db.post.create({ data: input })',
    ')',
  )
  await fs.promises.writeFile(postsServicePath, contentLines.join('\n'))
}

export async function uniquePostTitles(postsScenariosPath: string) {
  const content = await fs.promises.readFile(postsScenariosPath, 'utf-8')
  await fs.promises.writeFile(
    postsScenariosPath,
    content.replaceAll(
      "title: 'String'",
      (_match, offset) => `title: 'String${offset}'`,
    ),
  )
}
