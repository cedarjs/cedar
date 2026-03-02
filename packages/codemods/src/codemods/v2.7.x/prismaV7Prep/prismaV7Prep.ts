import fs from 'node:fs'
import path from 'node:path'

import {
  ensurePosixPath,
  getDataMigrationsPath,
  getPaths,
} from '@cedarjs/project-config'

export type PrismaV7PrepContext = {
  dataMigrationsPath: string
  dbFilePath: string | null
  paths: ReturnType<typeof getPaths>
}

export type TransformDirectoryResult = {
  filesSeen: number
  filesUpdated: number
}

const CODE_FILE_GLOB = '**/*.{ts,tsx,cts,mts,js,jsx,cjs,mjs}'
const PRISMA_CLIENT_REEXPORT = "export * from '@prisma/client'"

function insertDbReexport(source: string) {
  if (source.includes(PRISMA_CLIENT_REEXPORT)) {
    return source
  }

  const lines = source.split('\n')
  const prismaImportIndex = lines.findIndex((line) =>
    /from\s+['"]@prisma\/client['"]/.test(line),
  )

  if (prismaImportIndex < 0) {
    throw new Error('Unexpected src/lib/db content')
  }

  lines.splice(prismaImportIndex + 1, 0, '', PRISMA_CLIENT_REEXPORT)

  return lines.join('\n')
}

async function collectCodeFiles(dir: string) {
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

export async function getPrismaV7PrepContext(): Promise<PrismaV7PrepContext> {
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

  return {
    dataMigrationsPath,
    dbFilePath,
    paths,
  }
}

export async function updateDbFile(
  dbFilePath: string | null,
): Promise<'updated' | 'skipped' | 'unmodified'> {
  if (!dbFilePath) {
    return 'skipped'
  }

  const source = await fs.promises.readFile(dbFilePath, 'utf-8')
  const transformed = insertDbReexport(source)

  if (transformed === source) {
    return 'unmodified'
  }

  await fs.promises.writeFile(dbFilePath, transformed)
  return 'updated'
}

export async function rewritePrismaImportsInDirectory(
  dir: string,
  dbFilePath: string | null,
) {
  const scriptsDir = ensurePosixPath(getPaths().scripts)
  const normalizedDbFilePath = dbFilePath ? ensurePosixPath(dbFilePath) : null
  const fileMatches = await collectCodeFiles(dir)
  const files = fileMatches
    .map((relativePath) => path.join(dir, relativePath))
    .filter((filePath) => ensurePosixPath(filePath) !== normalizedDbFilePath)

  if (files.length === 0) {
    return 'skipped'
  }

  for (const filePath of files) {
    const source = await fs.promises.readFile(filePath, 'utf-8')
    const isScriptFile = ensurePosixPath(filePath).startsWith(scriptsDir)
    const importPath = isScriptFile ? 'api/src/lib/db' : 'src/lib/db'
    const importPattern = /(['"])@prisma\/client\1/g
    const transformed = source.replace(importPattern, `$1${importPath}$1`)

    if (transformed !== source) {
      await fs.promises.writeFile(filePath, transformed)
    }
  }

  return 'updated'
}

async function prismaV7Prep() {
  const context = await getPrismaV7PrepContext()
  await updateDbFile(context.dbFilePath)

  const dirsToTransform = [
    context.paths.api.src,
    context.dataMigrationsPath,
    context.paths.scripts,
  ]

  for (const dir of dirsToTransform) {
    await rewritePrismaImportsInDirectory(dir, context.dbFilePath)
  }
}

export default prismaV7Prep
