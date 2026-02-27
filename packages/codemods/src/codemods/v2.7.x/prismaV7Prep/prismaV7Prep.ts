import fs from 'node:fs'
import path from 'node:path'

import type { FileInfo } from 'jscodeshift'
import j from 'jscodeshift'

import { getDataMigrationsPath, getPaths } from '@cedarjs/project-config'

import prettify from '../../../lib/prettify'

export type PrismaV7PrepContext = {
  dataMigrationsPath: string
  dbFilePath: string | null
  paths: ReturnType<typeof getPaths>
}

export type TransformDirectoryResult = {
  filesSeen: number
  filesUpdated: number
}

function getParserForFile(filePath: string) {
  if (filePath.endsWith('.tsx') || filePath.endsWith('.jsx')) {
    return j.withParser('tsx')
  }

  return j.withParser('ts')
}

function getPrettierParserForFile(filePath: string) {
  if (
    filePath.endsWith('.ts') ||
    filePath.endsWith('.tsx') ||
    filePath.endsWith('.cts') ||
    filePath.endsWith('.mts')
  ) {
    return 'typescript'
  }

  return 'babel'
}

function transformDbFile(file: FileInfo) {
  const parser = getParserForFile(file.path)
  const root = parser(file.source)

  // Check if export * from '@prisma/client' already exists
  const existingExport = root.find(parser.ExportAllDeclaration, {
    source: { value: '@prisma/client' },
  })

  if (existingExport.length > 0) {
    return file.source
  }

  // Find the import of PrismaClient
  const prismaClientImport = root.find(parser.ImportDeclaration, {
    source: { value: '@prisma/client' },
  })

  if (prismaClientImport.length === 0) {
    return file.source
  }

  // Add the export after the import
  const importNode = prismaClientImport.get()
  const exportStatement = parser.exportAllDeclaration(
    parser.literal('@prisma/client'),
    null,
  )

  // Insert after the import
  importNode.insertAfter(exportStatement)

  return root.toSource()
}

function transformOtherFile(file: FileInfo) {
  const parser = getParserForFile(file.path)
  const root = parser(file.source)

  // Determine the correct import path based on file location
  const isInRootScripts = file.path.startsWith(getPaths().scripts + path.sep)
  const importPath = isInRootScripts ? 'api/src/lib/db' : 'src/lib/db'

  // Replace all imports from '@prisma/client' to the appropriate path
  root
    .find(parser.ImportDeclaration, {
      source: { value: '@prisma/client' },
    })
    .forEach((importDecl) => {
      importDecl.get('source').replace(parser.literal(importPath))
    })

  return root.toSource()
}

export async function getPrismaV7PrepContext(): Promise<PrismaV7PrepContext> {
  const paths = getPaths()
  const prismaConfigPath = paths.api.prismaConfig
  const dataMigrationsPath = await getDataMigrationsPath(prismaConfigPath)

  // Transform db.ts or db.js
  const dbPath = path.join(paths.api.lib, 'db.ts')
  const dbPathJs = path.join(paths.api.lib, 'db.js')

  let dbFilePath = dbPath
  if (!fs.existsSync(dbPath)) {
    dbFilePath = dbPathJs
  }

  return {
    dataMigrationsPath,
    dbFilePath: fs.existsSync(dbFilePath) ? dbFilePath : null,
    paths,
  }
}

export async function updateDbFile(
  dbFilePath: string | null,
): Promise<'updated' | 'skipped'> {
  if (!dbFilePath) {
    return 'skipped'
  }

  const source = fs.readFileSync(dbFilePath, 'utf-8')
  const transformed = transformDbFile({ source, path: dbFilePath })
  fs.writeFileSync(
    dbFilePath,
    await prettify(transformed, {
      parser: getPrettierParserForFile(dbFilePath),
    }),
  )

  return 'updated'
}

export async function rewritePrismaImportsInDirectory(
  dir: string,
  dbFilePath: string | null,
): Promise<TransformDirectoryResult> {
  if (!fs.existsSync(dir)) {
    return {
      filesSeen: 0,
      filesUpdated: 0,
    }
  }

  const files = fs
    .readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter(
      (file) =>
        file.endsWith('.ts') ||
        file.endsWith('.cts') ||
        file.endsWith('.mts') ||
        file.endsWith('.tsx') ||
        file.endsWith('.js') ||
        file.endsWith('.cjs') ||
        file.endsWith('.mjs') ||
        file.endsWith('.jsx'),
    )
    .map((file) => path.join(dir, file))
    .filter((file) => fs.statSync(file).isFile())
    .filter((file) => file !== dbFilePath) // Skip db.ts

  let filesUpdated = 0

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf-8')
    const transformed = transformOtherFile({ source, path: file })
    const prettified = await prettify(transformed, {
      parser: getPrettierParserForFile(file),
    })

    if (prettified !== source) {
      filesUpdated += 1
      fs.writeFileSync(file, prettified)
    }
  }

  return {
    filesSeen: files.length,
    filesUpdated,
  }
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
