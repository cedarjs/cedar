import fs from 'node:fs'
import path from 'node:path'

import { Listr } from 'listr2'

import {
  addApiPackages,
  addWebPackages,
  colors as c,
} from '@cedarjs/cli-helpers'
import {
  getConfigPath,
  getMigrationsPath,
  getSchemaPath,
} from '@cedarjs/project-config'
import { errorTelemetry } from '@cedarjs/telemetry'

// @ts-expect-error - No types for JS files
import { getPaths, transformTSToJS, writeFile } from '../../../lib/index.js'
// @ts-expect-error - No types for JS files
import { isTypeScriptProject } from '../../../lib/project.js'

function getApiPackageJson() {
  const apiPackageJsonPath = path.join(getPaths().api.base, 'package.json')
  return JSON.parse(fs.readFileSync(apiPackageJsonPath, 'utf-8'))
}

function getWebPackageJson() {
  const webPackageJsonPath = path.join(getPaths().web.base, 'package.json')
  return JSON.parse(fs.readFileSync(webPackageJsonPath, 'utf-8'))
}

function hasPackage(
  packageJson: {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  },
  packageName: string,
) {
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
 * @returns provider name in lowercase, or undefined
 */
async function getPrismaProvider() {
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
    } catch {
      stat = undefined
    }

    if (stat?.isDirectory()) {
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
    if (match?.[1]) {
      return match[1].toLowerCase()
    }

    return undefined
  } catch {
    // Be permissive: return undefined on any unexpected error
    return undefined
  }
}

function findExistingLiveQueryMigration(migrationsDirectoryPath: string) {
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

function generateMigrationFolderName() {
  const now = new Date()

  const year = String(now.getFullYear())
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const hour = String(now.getHours()).padStart(2, '0')
  const minute = String(now.getMinutes()).padStart(2, '0')
  const second = String(now.getSeconds()).padStart(2, '0')

  return `${year}${month}${day}${hour}${minute}${second}_live_queries_notifications`
}

function addLiveQueryListenerToGraphqlHandler({ force }: { force?: boolean }) {
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

  // Anchoring both these regexes to the start of the line to not match on
  // imports that have been commented out. (This won't catch /* ... */ style
  // multiline comments that start and end on lines before/after the listener
  // import, but that's a tradeoff I'm willing to make in favor of not over-
  // complicating this code)
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
    const loggerImportIndex = contentLines.findIndex((line) =>
      /import { logger } from ['"]src\/lib\/logger['"]/.test(line),
    )

    // Right before the logger import if found, otherwise right after all
    // existing imports
    const insertIndex =
      loggerImportIndex >= 0 ? loggerImportIndex : lastImportIndex + 1

    contentLines.splice(
      insertIndex,
      0,
      "import { startLiveQueryListener } from 'src/lib/liveQueriesListener'",
    )
  }

  const handlerIndexAfterImport = hasImport ? handlerIndex : handlerIndex + 1

  if (!hasStartCall) {
    contentLines.splice(
      handlerIndexAfterImport,
      0,
      "// Fire-and-forget: we intentionally don't await this so it doesn't " +
        'block the',
      "// GraphQL handler from being registered. The listener doesn't need " +
        'to be ready',
      '// before the first request is handled.',
      'void startLiveQueryListener()',
      '',
    )
  }

  fs.writeFileSync(graphqlHandlerPath, contentLines.join('\n'))

  return {
    skipped: false,
  }
}

function addConfigureGqlormToApp({ force }: { force?: boolean }) {
  const appPath = getPaths().web.app

  if (!fs.existsSync(appPath)) {
    return {
      skipped: true,
      reason: `${path.basename(appPath)} not found`,
    }
  }

  const content = fs.readFileSync(appPath, 'utf-8')
  const contentLines = content.split('\n')

  const hasGqlormImport = contentLines.some((line) =>
    line.includes("from '@cedarjs/gqlorm/setup'"),
  )

  const hasSchemaImport = contentLines.some((line) =>
    line.includes("from '../../.cedar/gqlorm-schema.json'"),
  )

  const hasConfigureCall = contentLines.some((line) =>
    line.includes('configureGqlorm({ schema })'),
  )

  if (hasGqlormImport && hasSchemaImport && hasConfigureCall && !force) {
    return {
      skipped: true,
      reason: 'configureGqlorm is already wired into App',
    }
  }

  if (!hasGqlormImport) {
    const redwoodWebImportIndex = contentLines.findIndex((line) =>
      line.includes("from '@cedarjs/web'"),
    )

    if (redwoodWebImportIndex === -1) {
      return {
        skipped: true,
        reason:
          "Unexpected syntax. Could not find @cedarjs/web import to " +
          'insert gqlorm import',
      }
    }

    contentLines.splice(
      redwoodWebImportIndex,
      0,
      "import { configureGqlorm } from '@cedarjs/gqlorm/setup'",
    )
  }

  if (!hasSchemaImport) {
    const fatalErrorPageIndex = contentLines.findIndex((line) =>
      line.includes("import FatalErrorPage from 'src/pages/FatalErrorPage'"),
    )

    if (fatalErrorPageIndex === -1) {
      return {
        skipped: true,
        reason:
          'Unexpected syntax. Could not find FatalErrorPage import to ' +
          'insert schema import',
      }
    }

    contentLines.splice(
      fatalErrorPageIndex + 1,
      0,
      "import schema from '../../.cedar/gqlorm-schema.json' " +
        "with { type: 'json' }",
    )
  }

  if (!hasConfigureCall) {
    // const App = works for both TS (const App = ({ children }: AppProps) => ()
    // and JS (const App = () => ()
    const appComponentIndex = contentLines.findIndex((line) =>
      /^const App\s*=/.test(line),
    )

    if (appComponentIndex === -1) {
      return {
        skipped: true,
        reason:
          'Unexpected syntax. Could not find `const App =` to insert ' +
          'configureGqlorm call',
      }
    }

    contentLines.splice(
      appComponentIndex,
      0,
      'configureGqlorm({ schema })',
      '',
    )
  }

  fs.writeFileSync(appPath, contentLines.join('\n'))

  return {
    skipped: false,
  }
}

interface HandlerArgs {
  force?: boolean
  verbose?: boolean
}

export async function handler({ force, verbose }: HandlerArgs) {
  const projectIsTypescript = isTypeScriptProject()
  const apiPackageJson = getApiPackageJson()
  const migrationsPath = await getMigrationsPath(getPaths().api.prismaConfig)

  const hasRealtimeDependency = hasPackage(apiPackageJson, '@cedarjs/realtime')
  const hasPgDependency = hasPackage(apiPackageJson, 'pg')
  const webPackageJson = getWebPackageJson()
  const hasGqlormDependency = hasPackage(webPackageJson, '@cedarjs/gqlorm')
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

  const existingMigrationPath = findExistingLiveQueryMigration(migrationsPath)
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
        title: 'Adding [experimental.gqlorm] config...',
        task: (_ctx, task) => {
          const configTomlPath = getConfigPath()
          const configFileName = path.basename(configTomlPath)
          const configContent = fs.readFileSync(configTomlPath, 'utf-8')

          if (!configContent.includes('[experimental.gqlorm]')) {
            writeFile(
              configTomlPath,
              configContent.concat(
                '\n[experimental.gqlorm]\n  enabled = true\n',
              ),
              {
                overwriteExisting: true,
              },
            )
          } else {
            if (force) {
              task.output = `Overwriting config in ${configFileName}`
              writeFile(
                configTomlPath,
                configContent.replace(
                  '\n[experimental.gqlorm]\n  enabled = false\n',
                  '\n[experimental.gqlorm]\n  enabled = true\n',
                ),
                {
                  overwriteExisting: true,
                },
              )
            } else {
              task.skip(
                `The [experimental.gqlorm] config block already exists in ${configFileName}.`,
              )
            }
          }
        },
        rendererOptions: { persistentOutput: true },
      },
      {
        ...addApiPackages(['pg@^8.18.0']),
        title: 'Adding pg dependency to your api workspace...',
        skip: () => {
          if (hasPgDependency) {
            return 'pg is already installed'
          }

          return false
        },
      },
      {
        title: 'Adding live query notification migration...',
        task: () => {
          const migrationTemplate = fs.readFileSync(
            migrationTemplatePath,
            'utf-8',
          )

          const targetPath =
            force && existingMigrationPath
              ? existingMigrationPath
              : migrationPath

          writeFile(targetPath, migrationTemplate, {
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

          return false
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
        ...addWebPackages(['@cedarjs/gqlorm']),
        title: 'Adding @cedarjs/gqlorm to your web workspace...',
        skip: () => {
          if (hasGqlormDependency) {
            return '@cedarjs/gqlorm is already installed'
          }

          return false
        },
      },
      {
        title: 'Wiring configureGqlorm into App.tsx...',
        task: (_ctx, task) => {
          const result = addConfigureGqlormToApp({ force })

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

          You're then ready to use @live queries to get real-time updates as
          soon as something in your database changes.
        `
        },
      },
    ],
    {
      rendererOptions: { collapseSubtasks: false },
      renderer: verbose ? 'verbose' : 'default',
    },
  )

  try {
    await tasks.run()
  } catch (e) {
    if (isObject(e) && 'message' in e) {
      errorTelemetry(process.argv, e.message)
      console.error(c.error(e.message))
    } else {
      errorTelemetry(process.argv, e)
      console.error(c.error(e))
    }

    process.exit(isObjectWithExitCode(e) ? e.exitCode : 1)
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isObjectWithExitCode(value: unknown): value is { exitCode: number } {
  return isObject(value) && typeof value.exitCode === 'number'
}
