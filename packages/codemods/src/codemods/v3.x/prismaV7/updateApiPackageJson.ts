import fs from 'node:fs'

// These versions are pinned to match the Cedar framework's own dependencies.
// Keep in sync with packages/create-cedar-app/templates/ts/api/package.json.
export const ADAPTER_PACKAGE = '@prisma/adapter-better-sqlite3'
export const SQLITE_PACKAGE = 'better-sqlite3'
export const ADAPTER_VERSION = '^7.0.0'
export const SQLITE_VERSION = '^12.0.0'

export const PG_ADAPTER_PACKAGE = '@prisma/adapter-pg'
export const PG_PACKAGE = 'pg'
export const PG_ADAPTER_VERSION = '^7.0.0'
export const PG_VERSION = '^8.0.0'

export type UpdateApiPackageJsonResult = 'skipped' | 'unmodified' | 'updated'

export type PackageJson = {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  [key: string]: unknown
}

export type TransformOptions = {
  provider?: string
  adapterVersion?: string
  sqliteVersion?: string
  pgAdapterVersion?: string
  pgVersion?: string
}

/**
 * Transforms the api/package.json content by adding the appropriate adapter
 * dependencies for the given provider. Returns the same string if no changes
 * are needed.
 */
export function transformApiPackageJson(
  source: string,
  {
    provider = 'sqlite',
    adapterVersion = ADAPTER_VERSION,
    sqliteVersion = SQLITE_VERSION,
    pgAdapterVersion = PG_ADAPTER_VERSION,
    pgVersion = PG_VERSION,
  }: TransformOptions = {},
): string {
  const pkg = JSON.parse(source) as PackageJson

  const isPostgres = provider === 'postgresql' || provider === 'postgres'

  if (isPostgres) {
    if (pkg.dependencies?.[PG_ADAPTER_PACKAGE]) {
      // Already present — idempotent
      return source
    }

    pkg.dependencies = {
      ...(pkg.dependencies ?? {}),
      [PG_ADAPTER_PACKAGE]: pgAdapterVersion,
      [PG_PACKAGE]: pgVersion,
    }
  } else {
    if (pkg.dependencies?.[ADAPTER_PACKAGE]) {
      // Already present — idempotent
      return source
    }

    pkg.dependencies = {
      ...(pkg.dependencies ?? {}),
      [ADAPTER_PACKAGE]: adapterVersion,
      [SQLITE_PACKAGE]: sqliteVersion,
    }
  }

  // Preserve the original indentation style
  const indentMatch = source.match(/^(\s+)"/m)
  const indent = indentMatch ? indentMatch[1] : '  '

  return JSON.stringify(pkg, null, indent.length) + '\n'
}

export async function updateApiPackageJson(
  packageJsonPath: string,
  options: TransformOptions = {},
): Promise<UpdateApiPackageJsonResult> {
  if (!fs.existsSync(packageJsonPath)) {
    return 'skipped'
  }

  const source = fs.readFileSync(packageJsonPath, 'utf-8')
  const pkg = JSON.parse(source) as PackageJson

  const isPostgres =
    options.provider === 'postgresql' || options.provider === 'postgres'
  const sentinelPackage = isPostgres ? PG_ADAPTER_PACKAGE : ADAPTER_PACKAGE

  if (pkg.dependencies?.[sentinelPackage]) {
    return 'unmodified'
  }

  const transformed = transformApiPackageJson(source, options)

  if (transformed === source) {
    return 'unmodified'
  }

  fs.writeFileSync(packageJsonPath, transformed, 'utf-8')
  return 'updated'
}
