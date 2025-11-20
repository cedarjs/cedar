import fs from 'node:fs'
import { Module } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import type { PrismaConfig } from './types.js'

// Cache for loaded configs to avoid repeated file system operations
const configCache = new Map<string, PrismaConfig>()

/**
 * Reads and returns the Prisma configuration from prisma.config.ts
 *
 * @param prismaConfigPath - Absolute path to the prisma.config.ts file
 * @returns The Prisma configuration object
 */
export async function loadPrismaConfig(
  prismaConfigPath: string,
): Promise<PrismaConfig> {
  if (!fs.existsSync(prismaConfigPath)) {
    throw new Error(`Prisma config file not found at: ${prismaConfigPath}`)
  }

  if (configCache.has(prismaConfigPath)) {
    return configCache.get(prismaConfigPath)!
  }

  const configUrl = pathToFileURL(prismaConfigPath).href

  try {
    const module = await import(configUrl)
    const config = module.default

    if (!config) {
      throw new Error('Prisma config must have a default export')
    }

    configCache.set(prismaConfigPath, config)
    return config
  } catch (error) {
    throw new Error(
      `Failed to load Prisma config from ${prismaConfigPath}: ${error}`,
    )
  }
}

/**
 * Synchronously reads and returns the Prisma configuration from prisma.config.ts
 * Note: This uses require internally, so it only works with CommonJS or transpiled configs
 *
 * @param prismaConfigPath - Absolute path to the prisma.config.ts file
 * @returns The Prisma configuration object
 */
export function loadPrismaConfigSync(prismaConfigPath: string): PrismaConfig {
  if (!fs.existsSync(prismaConfigPath)) {
    throw new Error(`Prisma config file not found at: ${prismaConfigPath}`)
  }

  if (configCache.has(prismaConfigPath)) {
    return configCache.get(prismaConfigPath)!
  }

  try {
    // Use dynamic require for synchronous loading
    // Create require from the config file's location
    const require = Module.createRequire(prismaConfigPath)
    // Clear require cache to ensure fresh load
    delete require.cache[require.resolve(prismaConfigPath)]
    const module = require(prismaConfigPath)
    const config = module.default || module

    if (!config) {
      throw new Error('Prisma config must have a default export')
    }

    configCache.set(prismaConfigPath, config)
    return config
  } catch (error) {
    throw new Error(
      `Failed to load Prisma config from ${prismaConfigPath}: ${error}`,
    )
  }
}

/**
 * Gets the schema path from Prisma config.
 * Defaults to 'schema.prisma' in the same directory as the config file if not specified.
 *
 * @param prismaConfigPath - Absolute path to the prisma.config.ts file
 * @returns Absolute path to the schema file or directory
 */
export async function getSchemaPath(prismaConfigPath: string): Promise<string> {
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
 * Synchronously gets the schema path from Prisma config.
 * Defaults to 'schema.prisma' in the same directory as the config file if not specified.
 *
 * @param prismaConfigPath - Absolute path to the prisma.config.ts file
 * @returns Absolute path to the schema file or directory
 */
export function getSchemaPathSync(prismaConfigPath: string): string {
  const config = loadPrismaConfigSync(prismaConfigPath)
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
 * Gets the migrations path from Prisma config.
 * Defaults to 'migrations' in the same directory as the schema.
 *
 * @param prismaConfigPath - Absolute path to the prisma.config.ts file
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
 * Synchronously gets the migrations path from Prisma config.
 * Defaults to 'migrations' in the same directory as the schema.
 *
 * @param prismaConfigPath - Absolute path to the prisma.config.ts file
 * @returns Absolute path to the migrations directory
 */
export function getMigrationsPathSync(prismaConfigPath: string): string {
  const config = loadPrismaConfigSync(prismaConfigPath)
  const configDir = path.dirname(prismaConfigPath)

  if (config.migrations?.path) {
    return path.isAbsolute(config.migrations.path)
      ? config.migrations.path
      : path.resolve(configDir, config.migrations.path)
  }

  // Default to migrations directory next to the schema
  const schemaPath = getSchemaPathSync(prismaConfigPath)
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
 * @param prismaConfigPath - Absolute path to the prisma.config.ts file
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
 * Synchronously gets the database directory (directory containing the schema).
 * If schema is a directory, returns that directory.
 * If schema is a file, returns its parent directory.
 *
 * @param prismaConfigPath - Absolute path to the prisma.config.ts file
 * @returns Absolute path to the database directory
 */
export function getDbDirSync(prismaConfigPath: string): string {
  const schemaPath = getSchemaPathSync(prismaConfigPath)

  if (fs.existsSync(schemaPath) && fs.statSync(schemaPath).isDirectory()) {
    return schemaPath
  }

  return path.dirname(schemaPath)
}
