import fs from 'node:fs'
import path from 'node:path'

import { Listr } from 'listr2'

import { addApiPackages } from '@cedarjs/cli-helpers'
import { getMigrationsPath, getSchemaPath } from '@cedarjs/project-config'
import { errorTelemetry } from '@cedarjs/telemetry'

import c from '../../../lib/colors.js'
import { getPaths, transformTSToJS, writeFile } from '../../../lib/index.js'
import { isTypeScriptProject } from '../../../lib/project.js'

const getApiPackageJson = () => {
  const apiPackageJsonPath = path.join(getPaths().api.base, 'package.json')
  return JSON.parse(fs.readFileSync(apiPackageJsonPath, 'utf-8'))
}

const hasPackage = (packageJson, packageName) => {
  return Boolean(
    packageJson.dependencies?.[packageName] ||
    packageJson.devDependencies?.[packageName],
  )
}

/**
 * Resolve the Prisma schema path using the project's Prisma config and read the
 * provider from the schema file. This function is intentionally permissive:
 * - If it can't resolve the schema or read the file it returns undefined.
 * - It prefers to allow the setup to continue rather than produce false
 *   positives by throwing on ambiguous content.
 *
 * @returns {Promise<string|undefined>} provider name in lowercase, or undefined
 */
const getPrismaProvider = async () => {
  try {
    const prismaConfigPath = getPaths().api.prismaConfig

    if (!prismaConfigPath) {
      return undefined
    }

    let schemaPath = await getSchemaPath(prismaConfigPath)

    if (!schemaPath) {
      return undefined
    }

    // If schemaPath is a directory, look for a schema.prisma file inside it.
    let stat
    try {
      stat = fs.statSync(schemaPath)
    } catch (e) {
      stat = undefined
    }

    if (stat && stat.isDirectory()) {
      const candidate = path.join(schemaPath, 'schema.prisma')
      if (fs.existsSync(candidate)) {
        schemaPath = candidate
      } else {
        return undefined
      }
    }

    if (!fs.existsSync(schemaPath)) {
      return undefined
    }

    const content = fs.readFileSync(schemaPath, 'utf-8')
    const match = content.match(/^\s*provider\s*=\s*["']([^"']+)["']/im)
    if (match && match[1]) {
      return match[1].toLowerCase()
    }

    return undefined
  } catch {
    // Be permissive: return undefined on any unexpected error
    return undefined
  }
}

const findExistingLiveQueryMigration = ({ migrationsDirectoryPath }) => {
  if (!fs.existsSync(migrationsDirectoryPath)) {
    return undefined
  }

  const globPattern = path
    .join(migrationsDirectoryPath, '*', 'migration.sql')
    .replaceAll('\\', '/')

  const migrationFilePaths = fs.globSync(globPattern)

  return migrationFilePaths.find((migrationFilePath) => {
    const content = fs.readFileSync(migrationFilePath, 'utf-8')
    return content.includes('cedar_notify_table_change')
  })
}

const generateMigrationFolderName = () => {
  const now = new Date()

  const year = String(now.getFullYear())
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const hour = String(now.getHours()).padStart(2, '0')
  const minute = String(now.getMinutes()).padStart(2, '0')
  const second = String(now.getSeconds()).padStart(2, '0')

  return `${year}${month}${day}${hour}${minute}${second}_live_queries_notifications`
}

const addLiveQueryListenerToGraphqlHandler = ({ force }) => {
  const graphqlHandlerPath = path.join(
    getPaths().api.functions,
    `graphql.${isTypeScriptProject() ? 'ts' : 'js'}`,
  )

  if (!fs.existsSync(graphqlHandlerPath)) {
    return {
      skipped: true,
      reason: 'GraphQL handler not found',
    }
  }

  const contentLines = fs.readFileSync(graphqlHandlerPath, 'utf-8').split('\n')

  const importLineRegex =
    /^import {.*startLiveQueryListener.*} from ['"]src\/lib\/liveQueriesListener['"];?$/
  const multilineImportRegex =
    /^} from ['"]src\/lib\/liveQueriesListener['"];?$/

  const hasImport = contentLines.some((line) => {
    return importLineRegex.test(line) || multilineImportRegex.test(line)
  })

  const hasStartCall = contentLines.some(
    (line) =>
      line.trim().startsWith('startLiveQueryListener(') ||
      line.trim().startsWith('void startLiveQueryListener('),
  )

  if (hasImport && hasStartCall && !force) {
    return {
      skipped: true,
      reason: 'Listener is already wired into GraphQL handler',
    }
  }

  const handlerIndex = contentLines.findLastIndex(
    (line) => line === 'export const handler = createGraphQLHandler({',
  )

  if (handlerIndex === -1) {
    return {
      skipped: true,
      reason: 'Unexpected syntax. Handler not found',
    }
  }

  const lastImportIndex = contentLines
    .slice(0, handlerIndex)
    .findLastIndex((line) => line.startsWith('import '))

  if (lastImportIndex === -1) {
    return {
      skipped: true,
      reason: 'Unexpected syntax. No imports found',
    }
  }

  if (!hasImport) {
    contentLines.splice(
      lastImportIndex + 1,
      0,
      "import { startLiveQueryListener } from 'src/lib/liveQueriesListener'",
    )
  }

  const handlerIndexAfterImport = hasImport ? handlerIndex : handlerIndex + 1

  if (!hasStartCall) {
    contentLines.splice(
      handlerIndexAfterImport,
      0,
      '',
      'void startLiveQueryListener()',
    )
  }

  fs.writeFileSync(graphqlHandlerPath, contentLines.join('\n'))

  return {
    skipped: false,
  }
}

export const handler = async ({ force }) => {
  const projectIsTypescript = isTypeScriptProject()
  const apiPackageJson = getApiPackageJson()
  const migrationsPath = await getMigrationsPath(getPaths().api.prismaConfig)

  const hasRealtimeDependency = hasPackage(apiPackageJson, '@cedarjs/realtime')
  const hasPgDependency = hasPackage(apiPackageJson, 'pg')
  const ext = projectIsTypescript ? 'ts' : 'js'

  const migrationTemplatePath = path.resolve(
    import.meta.dirname,
    'templates',
    'migration.sql.template',
  )

  const listenerTemplatePath = path.resolve(
    import.meta.dirname,
    'templates',
    'liveQueriesListener.ts.template',
  )

  const existingMigrationPath = findExistingLiveQueryMigration({
    migrationsDirectoryPath: migrationsPath,
  })

  const migrationDirPath = path.join(
    migrationsPath,
    generateMigrationFolderName(),
  )

  const migrationPath = path.join(migrationDirPath, 'migration.sql')

  const listenerPath = path.join(
    getPaths().api.lib,
    `liveQueriesListener.${ext}`,
  )

  const tasks = new Listr(
    [
      {
        title: 'Checking for @cedarjs/realtime in api workspace...',
        task: () => {
          if (!hasRealtimeDependency) {
            throw new Error(
              '@cedarjs/realtime is not installed in your api workspace. ' +
                `Please run ${c.highlight('yarn cedar setup realtime')} first.`,
            )
          }
        },
      },
      {
        title: 'Checking that your database provider is PostgreSQL...',
        task: async () => {
          const prismaProvider = await getPrismaProvider()

          const unsupportedProviders = new Set([
            'sqlite',
            'mysql',
            'mongodb',
            'sqlserver',
            'cockroachdb',
          ])

          if (prismaProvider && unsupportedProviders.has(prismaProvider)) {
            throw new Error(
              `Only PostgreSQL is supported for now (found provider "${prismaProvider}").`,
            )
          }
        },
      },
      {
        ...addApiPackages(['pg@^8.18.0']),
        title: 'Adding pg dependency to your api side...',
        skip: () => {
          if (hasPgDependency) {
            return 'pg is already installed'
          }
        },
      },
      {
        title: 'Adding live query notification migration...',
        task: () => {
          const migrationTemplate = fs.readFileSync(
            migrationTemplatePath,
            'utf-8',
          )

          writeFile(migrationPath, migrationTemplate, {
            overwriteExisting: force,
          })
        },
        skip: () => {
          if (existingMigrationPath && !force) {
            const migrationPath = path.relative(
              getPaths().base,
              existingMigrationPath,
            )

            return `Existing live query migration found: ${migrationPath}`
          }
        },
      },
      {
        title: `Adding api/src/lib/liveQueriesListener.${ext}...`,
        task: async () => {
          const listenerTemplate = fs.readFileSync(
            listenerTemplatePath,
            'utf-8',
          )
          const listenerContent = projectIsTypescript
            ? listenerTemplate
            : await transformTSToJS(listenerPath, listenerTemplate)

          writeFile(listenerPath, listenerContent, {
            overwriteExisting: force,
          })
        },
      },
      {
        title: 'Wiring listener startup into GraphQL handler...',
        task: (_ctx, task) => {
          const result = addLiveQueryListenerToGraphqlHandler({ force })

          if (result.skipped) {
            task.skip(result.reason)
          }
        },
      },
      {
        title: 'One more thing...',
        task: (_ctx, task) => {
          task.title = `One more thing...

          ${c.success('\nLive query notifications configured!\n')}

          Apply the migration to activate Postgres notifications:
          ${c.highlight('\n\u00A0\u00A0yarn cedar prisma migrate dev\n')}

          Then run the API server and use @live queries with invalidation keys
          based on your GraphQL types and fields.
        `
        },
      },
    ],
    {
      rendererOptions: { collapseSubtasks: false },
    },
  )

  try {
    await tasks.run()
  } catch (e) {
    errorTelemetry(process.argv, e.message)
    console.error(c.error(e.message))
    process.exit(e?.exitCode || 1)
  }
}
