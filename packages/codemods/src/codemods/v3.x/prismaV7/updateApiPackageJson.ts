import fs from 'node:fs'

// These versions are pinned to match the Cedar framework's own dependencies.
// Keep in sync with packages/create-cedar-app/templates/ts/api/package.json.
export const ADAPTER_PACKAGE = '@prisma/adapter-better-sqlite3'
export const SQLITE_PACKAGE = 'better-sqlite3'
export const ADAPTER_VERSION = '^7.0.0'
export const SQLITE_VERSION = '^12.0.0'

export type UpdateApiPackageJsonResult = 'skipped' | 'unmodified' | 'updated'

export type PackageJson = {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  [key: string]: unknown
}

/**
 * Transforms the api/package.json content by adding the SQLite adapter
 * dependencies. Returns the same string if no changes are needed.
 */
export function transformApiPackageJson(
  source: string,
  adapterVersion = ADAPTER_VERSION,
  sqliteVersion = SQLITE_VERSION,
): string {
  const pkg = JSON.parse(source) as PackageJson

  if (pkg.dependencies?.[ADAPTER_PACKAGE]) {
    // Already present — idempotent
    return source
  }

  pkg.dependencies = {
    ...(pkg.dependencies ?? {}),
    [ADAPTER_PACKAGE]: adapterVersion,
    [SQLITE_PACKAGE]: sqliteVersion,
  }

  // Preserve the original indentation style
  const indentMatch = source.match(/^(\s+)"/m)
  const indent = indentMatch ? indentMatch[1] : '  '

  return JSON.stringify(pkg, null, indent.length) + '\n'
}

export async function updateApiPackageJson(
  packageJsonPath: string,
  adapterVersion = ADAPTER_VERSION,
  sqliteVersion = SQLITE_VERSION,
): Promise<UpdateApiPackageJsonResult> {
  if (!fs.existsSync(packageJsonPath)) {
    return 'skipped'
  }

  const source = fs.readFileSync(packageJsonPath, 'utf-8')

  const pkg = JSON.parse(source) as PackageJson

  if (pkg.dependencies?.[ADAPTER_PACKAGE]) {
    return 'unmodified'
  }

  const transformed = transformApiPackageJson(
    source,
    adapterVersion,
    sqliteVersion,
  )

  if (transformed === source) {
    return 'unmodified'
  }

  fs.writeFileSync(packageJsonPath, transformed, 'utf-8')
  return 'updated'
}
