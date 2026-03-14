import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import prismaInternals from '@prisma/internals'
import type { PrismaConfig } from 'prisma'

import { getPaths } from './paths.js'

const { createSchemaPathInput, getConfig, getSchemaWithPath } = prismaInternals

function getGeneratorOutputPathFromSchema(schemaPath: string) {
  console.log('getGeneratorOutputPathFromSchema schemaPath', schemaPath)
  if (!fs.existsSync(schemaPath)) {
    return undefined
  }

  const schemaContent = fs.readFileSync(schemaPath, 'utf-8')
  console.log('getGeneratorOutputPathFromSchema schemaContent', schemaContent)
  const generatorMatch = schemaContent.match(
    /generator\s+client\s*\{[\s\S]*?output\s*=\s*["']([^"']+)["'][^}]*\}/,
  )
  console.log('getGeneratorOutputPathFromSchema generatorMatch', generatorMatch)
  const output = generatorMatch?.[1]
  console.log('getGeneratorOutputPathFromSchema output', output)

  if (!output) {
    return undefined
  }

  return path.isAbsolute(output)
    ? output
    : path.resolve(path.dirname(schemaPath), output)
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
 * Gets the Prisma schemas for the given schema path.
 *
 * @param schemaPath - Absolute path to the Prisma schema file or directory
 *   (typically the value returned by `getSchemaPath`)
 * @returns The result of `getSchemaWithPath`, containing a `schemas` array of
 *   `[filePath, content]` tuples
 */
export async function getPrismaSchemasAtPath(schemaPath: string) {
  const schemaPathInput = createSchemaPathInput({
    baseDir: fs.lstatSync(schemaPath).isDirectory()
      ? schemaPath
      : path.dirname(schemaPath),
    schemaPathFromConfig: schemaPath,
  })

  return getSchemaWithPath({ schemaPath: schemaPathInput })
}

/**
 * Gets the Prisma schemas for the current project's default schema location.
 *
 * @returns The result of `getSchemaWithPath`, containing a `schemas` array of
 *   `[filePath, content]` tuples
 */
export async function getPrismaSchemas() {
  const schemaPath = await getSchemaPath(getPaths().api.prismaConfig)
  return getPrismaSchemasAtPath(schemaPath)
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

export async function resolveGeneratedPrismaClient({ mustExist = false } = {}) {
  console.log('resolveGeneratedPrismaClient mustExist', mustExist)
  const prismaConfigPath = getPaths().api.prismaConfig
  console.log('resolveGeneratedPrismaClient prismaConfigPath', prismaConfigPath)
  const schemaPath = await getSchemaPath(prismaConfigPath)
  console.log('resolveGeneratedPrismaClient schemaPath', schemaPath)
  const schemaDir = fs.statSync(schemaPath).isDirectory()
    ? schemaPath
    : path.dirname(schemaPath)
  console.log('resolveGeneratedPrismaClient schemaDir', schemaDir)

  let generatorOutputPath: string | undefined
  let ext = 'ts'
  try {
    const { schemas } = await getPrismaSchemasAtPath(schemaPath)
    console.log('resolveGeneratedPrismaClient schemas', schemas)
    const config = await getConfig({ datamodel: schemas })
    console.log('resolveGeneratedPrismaClient config', config)
    const generator =
      config.generators.find((entry) => entry.name === 'client') ??
      config.generators[0]
    console.log('resolveGeneratedPrismaClient generator', generator)
    const output = generator?.output?.value
    console.log('resolveGeneratedPrismaClient output', output)
    ext = Array.isArray(generator?.config?.generatedFileExtension)
      ? generator?.config?.generatedFileExtension[0]
      : generator?.config?.generatedFileExtension || ext

    if (output) {
      generatorOutputPath = path.isAbsolute(output)
        ? output
        : path.resolve(schemaDir, output)
      console.log(
        'resolveGeneratedPrismaClient config generatorOutputPath',
        generatorOutputPath,
      )
    }
  } catch {
    // Fall back to schema parsing
    // TODO: Remove this once we've verified that the code above works correctly
    generatorOutputPath = getGeneratorOutputPathFromSchema(schemaPath)
    console.log(
      'resolveGeneratedPrismaClient fallback generatorOutputPath',
      generatorOutputPath,
    )
  }

  // TODO: Fallbacks shouldn't be needed. Remove all of this
  const candidateEntries = [
    ...(generatorOutputPath
      ? [path.join(generatorOutputPath, 'client.' + ext)]
      : []),
    path.join(schemaDir, 'generated', 'client', 'client.' + ext),
    path.join(schemaDir, 'generated', 'prisma', 'client.' + ext),
    path.join(getPaths().base, 'node_modules/.prisma/client/index.js'),
  ].filter((entry, index, allEntries) => allEntries.indexOf(entry) === index)
  console.log('resolveGeneratedPrismaClient candidateEntries', candidateEntries)

  const prismaClientEntry = candidateEntries.find((entry) =>
    fs.existsSync(entry),
  )
  console.log(
    'resolveGeneratedPrismaClient prismaClientEntry',
    prismaClientEntry,
  )

  if (mustExist && !prismaClientEntry) {
    throw new Error(
      `Could not find generated Prisma client entry. Checked: ${candidateEntries.join(', ')}. ` +
        'Run `yarn cedar prisma generate` and try again.',
    )
  }

  return prismaClientEntry ?? candidateEntries[0]
}
