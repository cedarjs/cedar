import path from 'node:path'
import { styleText } from 'node:util'

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
  '(v3.x) Upgrades your Cedar app to use Prisma v7 – updates schema.prisma, ' +
  'db.ts, prisma.config.cjs, and related config files'

function step(label: string, output: string) {
  console.log(`  ${styleText('green', '✔')} ${styleText('bold', label)}`)
  console.log(`    → ${output}`)
}

export const handler = async () => {
  const context = await getPrismaV7Context()
  const { paths, isSqlite, isPostgres, provider, dbFilePath } = context

  console.log(styleText('bold', '❯ Prisma v7 Migration'))

  // Update schema.prisma
  const { results: schemaResults } = await runUpdateSchemaFile()

  if (schemaResults.length === 0) {
    step('Update schema.prisma', 'Skipped. No schema.prisma found')
  } else {
    for (const result of schemaResults) {
      if (result.status === 'skipped') {
        step('Update schema.prisma', `Skipped. ${result.path} not found`)
      } else if (result.status === 'unmodified') {
        step('Update schema.prisma', 'No changes needed (already migrated)')
      } else {
        step('Update schema.prisma', `Updated ${result.path}`)
      }

      for (const warning of result.warnings) {
        console.warn(`\n⚠️  ${warning}`)
      }
    }
  }

  // Update prisma.config.cjs
  const prismaConfigResult = await updatePrismaConfig(paths.api.prismaConfig)

  if (prismaConfigResult === 'skipped') {
    step('Update prisma.config.cjs', 'Skipped. prisma.config.cjs not found')
  } else if (prismaConfigResult === 'unmodified') {
    step(
      'Update prisma.config.cjs',
      'No changes needed (already has datasource block)',
    )
  } else {
    step('Update prisma.config.cjs', `Updated ${paths.api.prismaConfig}`)
  }

  // Update api/src/lib/db.{ts,js}
  if (!dbFilePath) {
    step(
      'Update api/src/lib/db.{ts,js}',
      'Skipped. No api/src/lib/db.ts or api/src/lib/db.js found',
    )
  } else {
    await runTransform({
      transformPath: path.join(import.meta.dirname, 'updateDbFile.js'),
      targetPaths: [dbFilePath],
      parser: 'ts',
      options: {
        isSqlite,
        isPostgres,
        silent: true,
      } as Record<string, unknown>,
    })

    step('Update api/src/lib/db.{ts,js}', `Updated ${dbFilePath}`)

    if (!isSqlite && !isPostgres) {
      const installationUrl =
        'https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/introduction#installation'
      console.log(
        '    ℹ️  Non-SQLite database detected. The import paths in db.ts have been updated,\n' +
          "       but no driver adapter was added. You'll need to add one manually.\n" +
          `       See: ${installationUrl}`,
      )
    }
  }

  // Rewrite remaining @prisma/client imports
  await rewriteRemainingImports()
  step('Rewrite remaining @prisma/client imports', 'Done')

  // Update api/package.json
  if (!isSqlite && !isPostgres) {
    step(
      'Update api/package.json',
      'Skipped. Unsupported provider. Add your own driver adapter package.',
    )
  } else {
    const pkgPath = path.join(paths.api.base, 'package.json')
    const pkgResult = await updateApiPackageJson(pkgPath, { provider })

    if (pkgResult === 'skipped') {
      step('Update api/package.json', 'Skipped. api/package.json not found')
    } else if (pkgResult === 'unmodified') {
      step(
        'Update api/package.json',
        'No changes needed (adapter already installed)',
      )
    } else {
      step('Update api/package.json', `Updated ${pkgPath}`)
    }
  }

  // Update tsconfig.json files
  const tsConfigResults = await updateTsConfigs({
    apiTsConfig: path.join(paths.api.base, 'tsconfig.json'),
    scriptsTsConfig: path.join(paths.base, 'scripts', 'tsconfig.json'),
    webTsConfig: path.join(paths.web.base, 'tsconfig.json'),
  })

  const updatedTsConfigs = Object.entries(tsConfigResults)
    .filter(([, status]) => status === 'updated')
    .map(([name]) => name)

  if (updatedTsConfigs.length === 0) {
    step('Update tsconfig.json files', 'No changes needed')
  } else {
    step(
      'Update tsconfig.json files',
      `Updated: ${updatedTsConfigs.join(', ')}`,
    )
  }

  // Update .gitignore
  const gitignorePath = path.join(paths.base, '.gitignore')
  const gitignoreResult = await updateGitignore(gitignorePath)

  if (gitignoreResult === 'skipped') {
    step('Update .gitignore', 'Skipped. .gitignore not found')
  } else if (gitignoreResult === 'unmodified') {
    step('Update .gitignore', 'No changes needed')
  } else {
    step('Update .gitignore', `Updated ${gitignorePath}`)
  }

  // Update .env.defaults
  const envDefaultsPath = path.join(paths.base, '.env.defaults')
  const envDefaultsResult = await updateEnvDefaults(envDefaultsPath)

  if (envDefaultsResult === 'skipped') {
    step('Update .env.defaults', 'Skipped. .env.defaults not found')
  } else if (envDefaultsResult === 'unmodified') {
    step('Update .env.defaults', 'No changes needed')
  } else {
    step('Update .env.defaults', `Updated ${envDefaultsPath}`)
  }

  const dotEnvWarning = checkDotEnv(path.join(paths.base, '.env'))
  if (dotEnvWarning) {
    console.warn(`\n⚠️  ${dotEnvWarning}`)
  }

  // Next steps
  const nextSteps = []

  if (!isSqlite && !isPostgres) {
    nextSteps.push(
      '  1. Add a Prisma driver adapter for your database to api/src/lib/db.ts',
      '     See:  https://www.prisma.io/docs/orm/core-concepts/supported-databases/database-drivers',
    )
  }

  const offset = !isSqlite && !isPostgres ? 1 : 0
  nextSteps.push(
    `  ${offset + 1}. Run \`yarn install\` to install new dependencies`,
    `  ${offset + 2}. Run \`yarn cedar prisma generate\` to generate the new Prisma client`,
    `  ${offset + 3}. Run \`yarn cedar prisma migrate dev\` to verify migrations work`,
    `  ${offset + 4}. Run \`yarn cedar lint --fix\` to fix import ordering issues etc`,
  )
  console.log(styleText('bold', '\n  Next steps:'))
  console.log(nextSteps.join('\n'))
}
