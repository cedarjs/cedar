import task from 'tasuku'
import type { TaskInnerAPI } from 'tasuku'

import {
  getPrismaV7PrepContext,
  rewritePrismaImportsInDirectory,
  updateDbFile,
} from './prismaV7Prep'

export const command = 'prisma-v7-prep'
export const description =
  '(v2.7.x) Prepares for Prisma v7 by funneling imports through src/lib/db'

export const handler = () => {
  task('Prisma v7 Prep', async ({ setError }: TaskInnerAPI) => {
    try {
      const context = await getPrismaV7PrepContext()

      await task(
        'Resolve project paths',
        async ({ setOutput }: TaskInnerAPI) => {
          setOutput(
            `api/src: ${context.paths.api.src} | dataMigrations: ` +
              `${context.dataMigrationsPath} | scripts: ` +
              context.paths.scripts,
          )
        },
      )

      await task('Update api/src/lib/db re-export', async ({ setOutput }) => {
        const result = await updateDbFile(context.dbFilePath)
        if (result === 'skipped') {
          setOutput('Skipped (no api/src/lib/db.ts or api/src/lib/db.js found)')
          return
        }

        setOutput(`Updated ${context.dbFilePath}`)
      })

      await task('Rewrite imports in api/src', async ({ setOutput }) => {
        const result = await rewritePrismaImportsInDirectory(
          context.paths.api.src,
          context.dbFilePath,
        )
        setOutput(`Updated ${result.filesUpdated}/${result.filesSeen} files`)
      })

      await task(
        'Rewrite imports in api/db/dataMigrations',
        async ({ setOutput }) => {
          const result = await rewritePrismaImportsInDirectory(
            context.dataMigrationsPath,
            context.dbFilePath,
          )
          if (result.filesSeen === 0) {
            setOutput('Skipped (directory missing or empty)')
            return
          }

          setOutput(`Updated ${result.filesUpdated}/${result.filesSeen} files`)
        },
      )

      await task('Rewrite imports in scripts', async ({ setOutput }) => {
        const result = await rewritePrismaImportsInDirectory(
          context.paths.scripts,
          context.dbFilePath,
        )
        if (result.filesSeen === 0) {
          setOutput('Skipped (directory missing or empty)')
          return
        }

        setOutput(`Updated ${result.filesUpdated}/${result.filesSeen} files`)
      })
    } catch (e: any) {
      setError('Failed to codemod your project \n' + e?.message)
    }
  })
}
