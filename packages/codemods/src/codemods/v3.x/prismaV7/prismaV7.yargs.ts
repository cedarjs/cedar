import path from 'node:path'

import task from 'tasuku'

import { getPaths } from '@cedarjs/project-config'

import runTransform from '../../../lib/runTransform.js'

import { getPrismaV7Context } from './prismaV7.js'
import rewriteRemainingImports from './rewriteRemainingImports.js'
import { updateApiPackageJson } from './updateApiPackageJson.js'
import { checkDotEnv, updateEnvDefaults } from './updateEnvDefaults.js'
import { updateGitignore } from './updateGitignore.js'
import { updatePrismaConfig } from './updatePrismaConfig.js'
import runUpdateSchemaFile from './updateSchemaFile.js'
import { updateTsConfigs } from './updateTsConfigs.js'

export const command = 'prisma-v7'
export const description =
  '(v3.x) Upgrades your Cedar app to use Prisma v7 — updates schema.prisma, db.ts, prisma.config.cjs, and related config files'

export const handler = async () => {
  const context = await getPrismaV7Context()
  const { paths, isSqlite, dbFilePath } = context

  await task('Prisma v7 Migration', async ({ task }) => {
    await task.group(
      (task) => [
        task('Update schema.prisma', async ({ setOutput }) => {
          const { results } = await runUpdateSchemaFile()

          for (const result of results) {
            if (result.status === 'skipped') {
              setOutput(`Skipped — ${result.path} not found`)
            } else if (result.status === 'unmodified') {
              setOutput('No changes needed (already migrated)')
            } else {
              setOutput(`Updated ${result.path}`)
            }

            for (const warning of result.warnings) {
              console.warn(`\n⚠️  ${warning}`)
            }
          }

          if (results.length === 0) {
            setOutput('Skipped — no schema.prisma found')
          }
        }),

        task('Update prisma.config.cjs', async ({ setOutput }) => {
          const result = await updatePrismaConfig(paths.api.prismaConfig)

          if (result === 'skipped') {
            setOutput('Skipped — prisma.config.cjs not found')
          } else if (result === 'unmodified') {
            setOutput('No changes needed (already has datasource block)')
          } else {
            setOutput(`Updated ${paths.api.prismaConfig}`)
          }
        }),

        task('Update api/src/lib/db.{ts,js}', async ({ setOutput }) => {
          if (!dbFilePath) {
            setOutput(
              'Skipped — no api/src/lib/db.ts or api/src/lib/db.js found',
            )
            return
          }

          await runTransform({
            transformPath: path.join(import.meta.dirname, 'updateDbFile.js'),
            targetPaths: [dbFilePath],
            parser: 'ts',
            options: {
              isSqlite,
            } as Record<string, unknown>,
          })

          setOutput(`Updated ${dbFilePath}`)

          if (!isSqlite) {
            console.log(
              '\nℹ️  Non-SQLite database detected. The import paths in db.ts have\n' +
                '   been updated, but no driver adapter was added. If you want to\n' +
                '   use a Prisma driver adapter (recommended), add one manually.\n' +
                '   See: https://www.prisma.io/docs/orm/overview/databases/database-drivers',
            )
          }
        }),
      ],
      { concurrency: 1 },
    )

    await task.group(
      (task) => [
        task(
          'Rewrite remaining @prisma/client imports',
          async ({ setOutput }) => {
            await rewriteRemainingImports()
            setOutput('Done')
          },
        ),

        task('Update api/package.json', async ({ setOutput }) => {
          if (!isSqlite) {
            setOutput(
              'Skipped — non-SQLite project. Add your own driver adapter package.',
            )
            return
          }

          const pkgPath = path.join(paths.api.base, 'package.json')
          const result = await updateApiPackageJson(pkgPath)

          if (result === 'skipped') {
            setOutput('Skipped — api/package.json not found')
          } else if (result === 'unmodified') {
            setOutput('No changes needed (adapter already installed)')
          } else {
            setOutput(`Updated ${pkgPath}`)
          }
        }),

        task('Update tsconfig.json files', async ({ setOutput }) => {
          const results = await updateTsConfigs({
            apiTsConfig: path.join(paths.api.base, 'tsconfig.json'),
            scriptsTsConfig: path.join(paths.base, 'scripts', 'tsconfig.json'),
            webTsConfig: path.join(paths.web.base, 'tsconfig.json'),
          })

          const updated = Object.entries(results)
            .filter(([, status]) => status === 'updated')
            .map(([name]) => name)

          if (updated.length === 0) {
            setOutput('No changes needed')
          } else {
            setOutput(`Updated: ${updated.join(', ')}`)
          }
        }),

        task('Update .gitignore', async ({ setOutput }) => {
          const gitignorePath = path.join(paths.base, '.gitignore')
          const result = await updateGitignore(gitignorePath)

          if (result === 'skipped') {
            setOutput('Skipped — .gitignore not found')
          } else if (result === 'unmodified') {
            setOutput('No changes needed')
          } else {
            setOutput(`Updated ${gitignorePath}`)
          }
        }),

        task('Update .env.defaults', async ({ setOutput }) => {
          const envDefaultsPath = path.join(paths.base, '.env.defaults')
          const result = await updateEnvDefaults(envDefaultsPath)

          if (result === 'skipped') {
            setOutput('Skipped — .env.defaults not found')
          } else if (result === 'unmodified') {
            setOutput('No changes needed')
          } else {
            setOutput(`Updated ${envDefaultsPath}`)
          }

          const dotEnvWarning = checkDotEnv(path.join(paths.base, '.env'))
          if (dotEnvWarning) {
            console.warn(`\n⚠️  ${dotEnvWarning}`)
          }
        }),
      ],
      { concurrency: Infinity },
    )

    await task('Next steps', async ({ setOutput }) => {
      const projectPaths = getPaths()
      const dotEnvWarning = checkDotEnv(path.join(projectPaths.base, '.env'))
      if (dotEnvWarning) {
        console.warn(`\n⚠️  ${dotEnvWarning}`)
      }

      const steps = [
        '  1. Run `yarn install` to install new dependencies',
        '  2. Run `yarn cedar prisma generate` to generate the new Prisma client',
        '  3. Run `yarn cedar prisma migrate dev` to verify migrations work',
        '  4. Run `yarn cedar lint --fix` to fix any import ordering issues',
      ]

      if (!isSqlite) {
        steps.push(
          '  5. Add a Prisma driver adapter for your database to api/src/lib/db.ts',
          '     See: https://www.prisma.io/docs/orm/overview/databases/database-drivers',
        )
      }

      setOutput('\n\n' + steps.join('\n'))
    })
  })
}
