import fs from 'node:fs'
import path from 'node:path'

import {
  ensurePosixPath,
  getDataMigrationsPath,
  getPaths,
} from '@cedarjs/project-config'

export type RewriteRemainingImportsResult = 'skipped' | 'updated'

const CODE_FILE_GLOB = '**/*.{ts,tsx,cts,mts,js,jsx,cjs,mjs}'

// This is a copy of the same workaround used in the existing prismaV7Prep
// codemod — memfs doesn't support fs.promises.glob, so tests override it.
async function collectCodeFiles(dir: string): Promise<string[]> {
  try {
    return await Array.fromAsync(fs.promises.glob(CODE_FILE_GLOB, { cwd: dir }))
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return []
    }

    throw error
  }
}

/**
 * Rewrite any remaining `@prisma/client` imports in a directory to go through
 * `src/lib/db` (for files inside `api/src/`) or `api/src/lib/db` (for files
 * inside `scripts/`). Skips the `db.ts`/`db.js` file itself — that is handled
 * by the `updateDbFile` codemod.
 *
 * This is intentionally the same logic as the existing `prismaV7Prep` codemod
 * so it acts as a safe safety-net for files added after the prep codemod ran,
 * or for users who never ran prep at all.
 */
export async function rewritePrismaImportsInDirectory(
  dir: string,
  dbFilePath: string | null,
): Promise<RewriteRemainingImportsResult> {
  const scriptsDir = ensurePosixPath(getPaths().scripts)
  const normalizedDbFilePath = dbFilePath ? ensurePosixPath(dbFilePath) : null
  const fileMatches = await collectCodeFiles(dir)
  const files = fileMatches
    .map((relativePath) => path.join(dir, relativePath))
    .filter((filePath) => ensurePosixPath(filePath) !== normalizedDbFilePath)

  if (files.length === 0) {
    return 'skipped'
  }

  let anyUpdated = false

  for (const filePath of files) {
    const source = await fs.promises.readFile(filePath, 'utf-8')
    const isScriptFile = ensurePosixPath(filePath).startsWith(scriptsDir)
    const importPath = isScriptFile ? 'api/src/lib/db' : 'src/lib/db'
    const importPattern = /(['"])@prisma\/client\1/g
    const transformed = source.replace(importPattern, `$1${importPath}$1`)

    if (transformed !== source) {
      await fs.promises.writeFile(filePath, transformed)
      anyUpdated = true
    }
  }

  return anyUpdated ? 'updated' : 'skipped'
}

export default async function rewriteRemainingImports(): Promise<void> {
  const paths = getPaths()
  const prismaConfigPath = paths.api.prismaConfig
  const dataMigrationsPath = await getDataMigrationsPath(prismaConfigPath)

  const dbPathTs = path.join(paths.api.lib, 'db.ts')
  const dbPathJs = path.join(paths.api.lib, 'db.js')

  let dbFilePath: string | null = null
  if (fs.existsSync(dbPathTs)) {
    dbFilePath = dbPathTs
  } else if (fs.existsSync(dbPathJs)) {
    dbFilePath = dbPathJs
  }

  const dirsToTransform = [paths.api.src, dataMigrationsPath, paths.scripts]

  for (const dir of dirsToTransform) {
    await rewritePrismaImportsInDirectory(dir, dbFilePath)
  }
}
