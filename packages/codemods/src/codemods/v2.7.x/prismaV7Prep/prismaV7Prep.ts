import fs from 'node:fs'
import path from 'node:path'

import type { FileInfo, API } from 'jscodeshift'

import { getDataMigrationsPath, getPaths } from '@cedarjs/project-config'

function transformDbFile(file: FileInfo, api: API) {
  const j = api.jscodeshift
  const root = j(file.source)

  // Check if export * from '@prisma/client' already exists
  const existingExport = root.find(j.ExportAllDeclaration, {
    source: { value: '@prisma/client' },
  })

  if (existingExport.length > 0) {
    return file.source
  }

  // Find the import of PrismaClient
  const prismaClientImport = root.find(j.ImportDeclaration, {
    source: { value: '@prisma/client' },
  })

  if (prismaClientImport.length === 0) {
    return file.source
  }

  // Add the export after the import
  const importNode = prismaClientImport.get()
  const exportStatement = j.exportAllDeclaration(j.literal('@prisma/client'))

  // Insert after the import
  importNode.insertAfter(exportStatement)

  return root.toSource()
}

function transformOtherFile(file: FileInfo, api: API) {
  const j = api.jscodeshift
  const root = j(file.source)

  // Determine the correct import path based on file location
  const isInRootScripts = file.path.startsWith(
    path.join(getPaths().scripts, path.sep),
  )
  const importPath = isInRootScripts ? 'api/src/lib/db' : 'src/lib/db'

  // Replace all imports from '@prisma/client' to the appropriate path
  root
    .find(j.ImportDeclaration, {
      source: { value: '@prisma/client' },
    })
    .forEach((importDecl) => {
      importDecl.get('source').replace(j.literal(importPath))
    })

  return root.toSource()
}

async function prismaV7Prep() {
  const paths = getPaths()
  const prismaConfigPath = paths.api.prismaConfig
  const dataMigrationsPath = await getDataMigrationsPath(prismaConfigPath)

  // Transform db.ts or db.js
  const dbPath = path.join(paths.api.src, 'lib', 'db.ts')
  const dbPathJs = path.join(paths.api.src, 'lib', 'db.js')

  let dbFilePath = dbPath
  if (!fs.existsSync(dbPath)) {
    dbFilePath = dbPathJs
  }

  if (fs.existsSync(dbFilePath)) {
    const fileContent = fs.readFileSync(dbFilePath, 'utf-8')
    const transformed = transformDbFile(
      { source: fileContent, path: dbFilePath },
      { jscodeshift: require('jscodeshift') },
    )
    fs.writeFileSync(dbFilePath, transformed)
  }

  // Transform all other files under api/src/, api/db/dataMigrations/, and
  // scripts/
  const dirsToTransform = [paths.api.src, dataMigrationsPath, paths.scripts]

  for (const dir of dirsToTransform) {
    if (!fs.existsSync(dir)) {
      continue
    }

    const files = fs
      .readdirSync(dir, { recursive: true })
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

    for (const file of files) {
      const fileContent = fs.readFileSync(file, 'utf-8')
      const transformed = transformOtherFile(
        { source: fileContent, path: file },
        { jscodeshift: require('jscodeshift') },
      )
      fs.writeFileSync(file, transformed)
    }
  }
}

export default prismaV7Prep
