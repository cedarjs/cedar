import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'

import type { PrismaConfig } from 'prisma'

import { prettyPrintCedarCommand } from './packageManager.js'
import { getPaths } from './paths.js'

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
 * Gets the active datasource provider (e.g. `postgresql`, `mysql`, `sqlite`)
 * configured in the project's `schema.prisma`.
 */
export async function getPrismaDatasourceProvider(): Promise<string> {
  const mod = await import('@prisma/internals')
  // `mod.default || mod` handles ESM vs CJS interop: in ESM context
  // @prisma/internals resolves everything onto `default`, in CJS it's
  // directly on the module object.
  const { getConfig } = mod.default || mod

  const { schemas } = await getPrismaSchemas()
  const config = await getConfig({ datamodel: schemas })

  return config.datasources[0].activeProvider
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

/**
 * Gets the absolute output directories of the project's Prisma client
 * generators (`prisma-client` and `prisma-client-js`).
 *
 * Other generators are not included: third-party generators (e.g. Zod schema
 * generators) can emit source that relies on Cedar's import transforms.
 *
 * Returns an empty array if the schema can't be read or no client generator
 * has an output path.
 */
export async function getPrismaClientOutputDirs(): Promise<string[]> {
  try {
    const mod = await import('@prisma/internals')
    // `mod.default || mod` handles ESM vs CJS interop: in ESM context
    // @prisma/internals resolves everything onto `default`, in CJS it's
    // directly on the module object.
    const { getConfig } = mod.default || mod

    const { schemas, schemaRootDir } = await getPrismaSchemas()
    const config = await getConfig({ datamodel: schemas })

    return config.generators
      .filter((generator) =>
        ['prisma-client', 'prisma-client-js'].includes(
          generator.provider.value ?? '',
        ),
      )
      .map((generator) => generator.output?.value)
      .filter((output): output is string => Boolean(output))
      .map((output) =>
        path.isAbsolute(output) ? output : path.resolve(schemaRootDir, output),
      )
  } catch {
    return []
  }
}

/**
 * Same as `getPrismaClientOutputDirs()`, but resolved in a worker thread.
 *
 * Loading `@prisma/internals` has process-wide side effects that slow down a
 * Vite build running in the same process by several seconds on large
 * projects. A worker has its own module registry, so those side effects stay
 * contained.
 */
export function getPrismaClientOutputDirsIsolated(): Promise<string[]> {
  return new Promise((resolve) => {
    const worker = new Worker(
      new URL('./prismaClientOutputDirsWorker.js', import.meta.url),
    )

    worker.once('message', (outputDirs: unknown) => {
      resolve(
        Array.isArray(outputDirs)
          ? outputDirs.filter((dir): dir is string => typeof dir === 'string')
          : [],
      )
      void worker.terminate()
    })
    worker.once('error', () => resolve([]))
    worker.once('exit', () => resolve([]))
  })
}

/**
 * Creates a matcher that reports whether a file is part of the project's
 * generated Prisma client. Build pipelines use it to skip Cedar's source
 * transforms for that code.
 *
 * The output directories are resolved once and reused for the lifetime of the
 * matcher, so create a new one per build. Call `load()` from a build start
 * hook: resolving them lazily from the first transform makes the lookup
 * compete with module transforms, which stalls every transform waiting on it.
 *
 * @param resolveOutputDirs - Resolves the Prisma client output directories
 */
export function createPrismaClientFileMatcher(
  resolveOutputDirs: () => Promise<
    string[]
  > = getPrismaClientOutputDirsIsolated,
) {
  let outputDirs: Promise<string[]> | undefined

  const getOutputDirs = () => {
    outputDirs ??= resolveOutputDirs()

    return outputDirs
  }

  return {
    load: async () => {
      await getOutputDirs()
    },
    matches: async (filePath: string) => {
      return (await getOutputDirs()).some((dir) => {
        const relativePath = path.relative(dir, filePath)

        return (
          relativePath !== '' &&
          !relativePath.startsWith('..') &&
          !path.isAbsolute(relativePath)
        )
      })
    },
  }
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
    const pmCommand = prettyPrintCedarCommand(['prisma', 'generate'])
    return {
      clientPath: prismaClientEntry,
      error:
        `Could not find generated Prisma client entry. Checked: ${checked}. ` +
        `Run \`${pmCommand}\` and try again.`,
    }
  }

  return {
    clientPath: prismaClientEntry,
    error: undefined,
  }
}
