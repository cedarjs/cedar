import fs from 'node:fs'
import path from 'node:path'

import { getSchemaPath, getPaths } from '@cedarjs/project-config'

import rewriteRemainingImports from './rewriteRemainingImports.js'
import { updateApiPackageJson } from './updateApiPackageJson.js'
import { checkDotEnv, updateEnvDefaults } from './updateEnvDefaults.js'
import { updateGitignore } from './updateGitignore.js'
import { updatePrismaConfig } from './updatePrismaConfig.js'
import runUpdateSchemaFile from './updateSchemaFile.js'
import { updateTsConfigs } from './updateTsConfigs.js'

export type PrismaV7Context = {
  isSqlite: boolean
  paths: ReturnType<typeof getPaths>
  dbFilePath: string | null
}

/**
 * Detect the database provider from `schema.prisma`. Defaults to 'sqlite'
 * if the schema cannot be read.
 */
function detectProvider(schemaPath: string): string {
  if (!fs.existsSync(schemaPath)) {
    return 'sqlite'
  }

  const source = fs.readFileSync(schemaPath, 'utf-8')
  const match = source.match(
    /datasource\s+\w+\s*\{[^}]*provider\s*=\s*["']([^"']+)["']/,
  )
  return match ? match[1].toLowerCase() : 'sqlite'
}

export async function getPrismaV7Context(): Promise<PrismaV7Context> {
  const paths = getPaths()

  const schemaPath = await getSchemaPath(paths.api.prismaConfig)
  const provider = detectProvider(schemaPath)
  const isSqlite = provider === 'sqlite'

  const dbPathTs = path.join(paths.api.lib, 'db.ts')
  const dbPathJs = path.join(paths.api.lib, 'db.js')

  let dbFilePath: string | null = null
  if (fs.existsSync(dbPathTs)) {
    dbFilePath = dbPathTs
  } else if (fs.existsSync(dbPathJs)) {
    dbFilePath = dbPathJs
  }

  return { isSqlite, paths, dbFilePath }
}

export default async function prismaV7(): Promise<void> {
  const context = await getPrismaV7Context()
  const { paths, isSqlite } = context

  // 1. Update schema.prisma
  await runUpdateSchemaFile()

  // 2. Update prisma.config.cjs
  await updatePrismaConfig(paths.api.prismaConfig)

  // 3. Rewrite remaining @prisma/client imports as safety net
  await rewriteRemainingImports()

  // 4. Update api/package.json (SQLite only)
  if (isSqlite) {
    await updateApiPackageJson(path.join(paths.api.base, 'package.json'))
  }

  // 5. Update tsconfigs (TypeScript projects only)
  await updateTsConfigs({
    apiTsConfig: path.join(paths.api.base, 'tsconfig.json'),
    scriptsTsConfig: path.join(paths.base, 'scripts', 'tsconfig.json'),
    webTsConfig: path.join(paths.web.base, 'tsconfig.json'),
  })

  // 6. Update .gitignore
  await updateGitignore(path.join(paths.base, '.gitignore'))

  // 7. Update .env.defaults
  await updateEnvDefaults(path.join(paths.base, '.env.defaults'))

  // 8. Check .env for stale SQLite URL (warn only, don't modify)
  const dotEnvWarning = checkDotEnv(path.join(paths.base, '.env'))
  if (dotEnvWarning) {
    console.warn(`\nWarning: ${dotEnvWarning}`)
  }
}
