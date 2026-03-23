import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import type { PrismaConfig } from 'prisma'

import { getConfig } from './config.js'
import type { PackageManager } from './config.js'
import { getPaths } from './paths.js'

function getPackageManager(): PackageManager {
  try {
    return getConfig().packageManager || 'yarn'
  } catch {
    return 'yarn'
  }
}

function formatCedarCommand(
  args: string[],
  packageManager: PackageManager,
): string {
  if (packageManager === 'npm') {
    return `npm run cedar -- ${args.join(' ')}`
  }
  return `${packageManager} cedar ${args.join(' ')}`
}

// Cache for loaded configs to avoid repeated file system operations
const configCache = new Map<string, PrismaConfig>()

/**
 * Reads and returns the Prisma configuration at the specified path.
 *
 * @param prismaConfigPath - Absolute path to the Prisma configuration file
 * @returns The Prisma configuration object
 */
export async function loadPrismaConfig(prismaConfigPath: string) {
  if (!fs.existsSync(prismaConfigPath)) {
    throw new Error(`Prisma config file not found at: ${prismaConfigPath}`)
  }

  if (configCache.has(prismaConfigPath)) {
    return configCache.get(prismaConfigPath)!
  }

  const configUrl = pathToFileURL(prismaConfigPath).href

  let config: PrismaConfig | undefined

  try {
    const mod = await import(configUrl)
    // We need `mod.default || mod` for ESM + CJS support
    config = mod.default || mod

    if (!config) {
      throw new Error('Prisma config must have a default export')
    }

    configCache.set(prismaConfigPath, config)
  } catch (error) {
    throw new Error(
      `Failed to load Prisma config from ${prismaConfigPath}: ${error}`,
    )
  }

  return config
}

/**
 * Gets the schema path from Prisma config.
 * Defaults to 'schema.prisma' in the same directory as the config file if not
 * specified.
 *
 * @param prismaConfigPath - Absolute path to the Prisma configuration file
 * @returns Absolute path to the schema file or directory
 */
export async function getSchemaPath(prismaConfigPath: string) {
  const config = await loadPrismaConfig(prismaConfigPath)
  const configDir = path.dirname(prismaConfigPath)

  if (config.schema) {
    return path.isAbsolute(config.schema)
      ? config.schema
      : path.resolve(configDir, config.schema)
  }

  // Default to schema.prisma in the same directory as the config
  return path.join(configDir, 'schema.prisma')
}

/**
 * Gets the Prisma schemas for the current project's default schema location.
 */
export async function getPrismaSchemas() {
  const mod = await import('@prisma/internals')
  // `mod.default || mod` handles ESM vs CJS interop: in ESM context
  // @prisma/internals resolves everything onto `default`, in CJS it's
  // directly on the module object.
  const { createSchemaPathInput, getSchemaWithPath } = mod.default || mod

  const schemaPath = await getSchemaPath(getPaths().api.prismaConfig)
  const schemaPathInput = createSchemaPathInput({
    baseDir: fs.lstatSync(schemaPath).isDirectory()
      ? schemaPath
      : path.dirname(schemaPath),
    schemaPathFromConfig: schemaPath,
  })

  return getSchemaWithPath({ schemaPath: schemaPathInput })
}

/**
 * Gets the migrations path from Prisma config.
 * Defaults to 'migrations' in the same directory as the schema.
 *
 * @param prismaConfigPath - Absolute path to the Prisma configuration file
 * @returns Absolute path to the migrations directory
 */
export async function getMigrationsPath(
  prismaConfigPath: string,
): Promise<string> {
  const config = await loadPrismaConfig(prismaConfigPath)
  const configDir = path.dirname(prismaConfigPath)

  if (config.migrations?.path) {
    return path.isAbsolute(config.migrations.path)
      ? config.migrations.path
      : path.resolve(configDir, config.migrations.path)
  }

  // Default to migrations directory next to the schema
  const schemaPath = await getSchemaPath(prismaConfigPath)
  const schemaDir = fs.statSync(schemaPath).isDirectory()
    ? schemaPath
    : path.dirname(schemaPath)

  return path.join(schemaDir, 'migrations')
}

/**
 * Gets the database directory (directory containing the schema).
 * If schema is a directory, returns that directory.
 * If schema is a file, returns its parent directory.
 *
 * @param prismaConfigPath - Absolute path to the Prisma configuration file
 * @returns Absolute path to the database directory
 */
export async function getDbDir(prismaConfigPath: string): Promise<string> {
  const schemaPath = await getSchemaPath(prismaConfigPath)

  if (fs.existsSync(schemaPath) && fs.statSync(schemaPath).isDirectory()) {
    return schemaPath
  }

  return path.dirname(schemaPath)
}

/**
 * Gets the data migrations directory path.
 * Data migrations are a Cedar feature (not Prisma) that live alongside Prisma
 * migrations.
 * Defaults to 'dataMigrations' in the same directory as Prisma migrations.
 *
 * @param prismaConfigPath - Absolute path to the Prisma configuration file
 * @returns Absolute path to the data migrations directory
 */
export async function getDataMigrationsPath(
  prismaConfigPath: string,
): Promise<string> {
  const migrationsPath = await getMigrationsPath(prismaConfigPath)
  const migrationsDir = path.dirname(migrationsPath)

  return path.join(migrationsDir, 'dataMigrations')
}

type ResolveReturnType =
  | { clientPath: string; error: undefined }
  | { clientPath: string | undefined; error: string }

export async function resolveGeneratedPrismaClient(): Promise<ResolveReturnType> {
  let generatorOutputPath: string | undefined
  let ext = 'ts'

  try {
    const prismaInternalsMod = await import('@prisma/internals')
    // `mod.default || mod` handles ESM vs CJS interop: in ESM context
    // @prisma/internals resolves everything onto `default`, in CJS it's
    // directly on the module object.
    const { getConfig } = prismaInternalsMod.default || prismaInternalsMod

    const { schemas, schemaRootDir } = await getPrismaSchemas()
    const config = await getConfig({ datamodel: schemas })
    const generator =
      config.generators.find((entry) => entry.name === 'client') ??
      config.generators[0]
    const output = generator?.output?.value
    const generatedFileExtension = generator?.config?.generatedFileExtension
    const resolvedExtension = Array.isArray(generatedFileExtension)
      ? generatedFileExtension[0]
      : generatedFileExtension

    if (typeof resolvedExtension === 'string' && resolvedExtension.length > 0) {
      ext = resolvedExtension
    }

    if (output) {
      generatorOutputPath = path.isAbsolute(output)
        ? output
        : path.resolve(schemaRootDir, output)
    }
  } catch {
    // Ignore — generatorOutputPath remains undefined; the error will surface
    // below when mustExist is true.
  }

  const prismaClientEntry =
    typeof generatorOutputPath === 'string'
      ? path.join(generatorOutputPath, 'client.' + ext)
      : undefined

  if (!prismaClientEntry || !fs.existsSync(prismaClientEntry)) {
    const checked = prismaClientEntry ?? '(could not determine output path)'
    return {
      clientPath: prismaClientEntry,
      error:
        `Could not find generated Prisma client entry. Checked: ${checked}. ` +
        `Run \`${formatCedarCommand(['prisma', 'generate'], getPackageManager())}\` and try again.`,
    }
  }

  return {
    clientPath: prismaClientEntry,
    error: undefined,
  }
}
