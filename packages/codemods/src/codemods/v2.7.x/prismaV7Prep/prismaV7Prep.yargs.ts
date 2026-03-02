import task from 'tasuku'

import {
  getPrismaV7PrepContext,
  rewritePrismaImportsInDirectory,
  updateDbFile,
} from './prismaV7Prep'

export const command = 'prisma-v7-prep'
export const description =
  '(v2.7.x) Prepares for Prisma v7 by funneling imports through src/lib/db'

export const handler = async () => {
  const context = await getPrismaV7PrepContext()

  await task.group((task) => [
    task('Add api/src/lib/db re-export', async ({ setOutput }) => {
      const result = await updateDbFile(context.dbFilePath)
      if (result === 'skipped') {
        setOutput('Skipped (no api/src/lib/db.ts or api/src/lib/db.js found)')
        return
      } else if (result === 'unmodified') {
        setOutput('Skipped (no changes needed)')
        return
      }

      setOutput(`Updated ${context.dbFilePath}`)
    }),

    task('Rewrite imports in api/src', () =>
      rewritePrismaImportsInDirectory(
        context.paths.api.src,
        context.dbFilePath,
      ),
    ),

    task('Rewrite imports in api/db/dataMigrations', async ({ setOutput }) => {
      const result = await rewritePrismaImportsInDirectory(
        context.dataMigrationsPath,
        context.dbFilePath,
      )

      if (result === 'skipped') {
        setOutput('Skipped (directory missing or empty)')
      }
    }),

    task('Rewrite imports in scripts', async ({ setOutput }) => {
      const result = await rewritePrismaImportsInDirectory(
        context.paths.scripts,
        context.dbFilePath,
      )

      if (result === 'skipped') {
        setOutput('Skipped (directory missing or empty)')
      }
    }),
  ])

  console.log(
    "Some imports might be in the wrong order. If that's the case, you can " +
      'run `yarn cedar lint --fix` to reorder them.',
  )
}
