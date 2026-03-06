import task from 'tasuku'

import {
  getPrismaV7PrepContext,
  rewritePrismaImportsInDirectory,
  updateDbFile,
} from './prismaV7Prep.js'

export const command = 'prisma-v7-prep'
export const description =
  '(v2.7.x) Prepares for Prisma v7 by funneling imports through src/lib/db'

export const handler = async () => {
  const context = await getPrismaV7PrepContext()

  await task('Prisma v7 Prep', async ({ task }) => {
    await task.group(
      (task) => [
        task('Add api/src/lib/db re-export', async ({ setOutput }) => {
          const result = await updateDbFile(context.dbFilePath)

          if (result === 'skipped') {
            setOutput(
              'Skipped (no api/src/lib/db.ts or api/src/lib/db.js found)',
            )
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

        task(
          'Rewrite imports in api/db/dataMigrations',
          async ({ setOutput }) => {
            const result = await rewritePrismaImportsInDirectory(
              context.dataMigrationsPath,
              context.dbFilePath,
            )

            if (result === 'skipped') {
              setOutput('No data migrations found')
            }
          },
        ),

        task('Rewrite imports in scripts', async ({ setOutput }) => {
          const result = await rewritePrismaImportsInDirectory(
            context.paths.scripts,
            context.dbFilePath,
          )

          if (result === 'skipped') {
            setOutput('Skipped (directory missing or empty)')
          }
        }),
      ],
      {
        concurrency: Infinity,
      },
    )

    await task('One more thing...', async ({ setOutput }) => {
      setOutput(
        '\n\n' +
          'Some imports (most likely in your scenario files) might now be\n' +
          "in the wrong order. If that's the case, you can run\n" +
          '`yarn cedar lint --fix` to reorder them.',
      )
    })
  })
}
