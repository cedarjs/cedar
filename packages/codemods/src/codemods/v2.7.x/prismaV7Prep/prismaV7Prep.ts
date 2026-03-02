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

function getOffsetFromLineColumn(
  source: string,
  line: number,
  column: number,
): number {
  const lines = source.split('\n')
  let offset = 0

  for (let i = 1; i < line; i += 1) {
    offset += lines[i - 1].length + 1
  }

  return offset + column
}

function cloneImportDeclaration(
  parser: ReturnType<typeof getParserForFile>,
  node: {
    importKind?: string | null
    specifiers: Array<Record<string, any>>
    comments?: Array<Record<string, any>>
    leadingComments?: Array<Record<string, any>>
    trailingComments?: Array<Record<string, any>>
    innerComments?: Array<Record<string, any>>
  },
  source: string,
) {
  const cloneComments = (comments?: Array<Record<string, any>>) =>
    comments?.map((comment) => ({ ...comment }))

  const clonedSpecifiers = node.specifiers.map((specifier) => {
    if (specifier.type === 'ImportDefaultSpecifier') {
      const defaultSpecifier = parser.importDefaultSpecifier(
        parser.identifier(specifier.local.name),
      )
      defaultSpecifier.comments = cloneComments(specifier.comments)
      defaultSpecifier.leadingComments = cloneComments(specifier.leadingComments)
      defaultSpecifier.trailingComments = cloneComments(
        specifier.trailingComments,
      )
      return defaultSpecifier
    }

    if (specifier.type === 'ImportNamespaceSpecifier') {
      const namespaceSpecifier = parser.importNamespaceSpecifier(
        parser.identifier(specifier.local.name),
      )
      namespaceSpecifier.comments = cloneComments(specifier.comments)
      namespaceSpecifier.leadingComments = cloneComments(
        specifier.leadingComments,
      )
      namespaceSpecifier.trailingComments = cloneComments(
        specifier.trailingComments,
      )
      return namespaceSpecifier
    }

    const imported =
      specifier.imported.type === 'Identifier'
        ? parser.identifier(specifier.imported.name)
        : parser.literal(specifier.imported.value)
    const local = specifier.local
      ? parser.identifier(specifier.local.name)
      : undefined
    const clonedSpecifier = parser.importSpecifier(imported, local)

    if (specifier.importKind) {
      clonedSpecifier.importKind = specifier.importKind
    }

    clonedSpecifier.comments = cloneComments(specifier.comments)
    clonedSpecifier.leadingComments = cloneComments(specifier.leadingComments)
    clonedSpecifier.trailingComments = cloneComments(specifier.trailingComments)

    return clonedSpecifier
  })

  const clonedImport = parser.importDeclaration(
    clonedSpecifiers,
    parser.literal(source),
  )

  if (node.importKind) {
    clonedImport.importKind = node.importKind
  }

  clonedImport.comments = cloneComments(node.comments)
  clonedImport.leadingComments = cloneComments(node.leadingComments)
  clonedImport.trailingComments = cloneComments(node.trailingComments)
  clonedImport.innerComments = cloneComments(node.innerComments)

  return clonedImport
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

  return root.toSource({ quote: 'single' })
}

function transformOtherFile(file: FileInfo) {
  const parser = getParserForFile(file.path)
  const root = parser(file.source)
  const rewrittenImportNodes = new Set<object>()
  type ImportLike = { source: { value: unknown } }
  const getImportSource = (node: ImportLike) =>
    typeof node.source.value === 'string' ? node.source.value : ''
  const isExternalPackageImport = (node: ImportLike) => {
    const source = getImportSource(node)
    return (
      !source.startsWith('.') &&
      !source.startsWith('src/') &&
      !source.startsWith('api/src/')
    )
  }
  const getInternalImportRank = (source: string) => {
    if (source.startsWith('src/') || source.startsWith('api/src/')) {
      return 0
    }

    if (source.startsWith('./') || source.startsWith('../')) {
      return 1
    }

    return 2
  }

  // Determine the correct import path based on file location
  const isInRootScripts = file.path.startsWith(getPaths().scripts + path.sep)
  const importPath = isInRootScripts ? 'api/src/lib/db' : 'src/lib/db'

  const prismaImports = root.find(parser.ImportDeclaration, {
    source: { value: '@prisma/client' },
  })

  if (prismaImports.length === 0) {
    return file.source
  }

  // Replace all imports from '@prisma/client' to the appropriate path
  prismaImports.forEach((importDecl) => {
    importDecl.get('source').replace(parser.literal(importPath))
    rewrittenImportNodes.add(importDecl.value as object)
  })

  const internalImportPaths = new Set(['src/lib/db', 'api/src/lib/db'])
  const programBody = root.get().node.program.body

  // Keep changes scoped to the leading import block.
  let leadingImportCount = 0
  while (
    leadingImportCount < programBody.length &&
    programBody[leadingImportCount]?.type === 'ImportDeclaration'
  ) {
    leadingImportCount += 1
  }
  const originalRemainder =
    leadingImportCount < programBody.length && leadingImportCount > 0
      ? file.source.slice(
          getOffsetFromLineColumn(
            file.source,
            programBody[leadingImportCount - 1].loc.end.line,
            programBody[leadingImportCount - 1].loc.end.column,
          ),
        )
      : ''

  if (leadingImportCount > 0) {
    const importBlock = programBody.slice(0, leadingImportCount)
    const dbImports: typeof importBlock = []
    const otherImports: typeof importBlock = []

    for (const node of importBlock) {
      const source = node.source.value

      if (
        typeof source === 'string' &&
        internalImportPaths.has(source) &&
        rewrittenImportNodes.has(node as object) &&
        node.type === 'ImportDeclaration'
      ) {
        const rebuiltImport = cloneImportDeclaration(parser, node, source)

        dbImports.push(rebuiltImport)
      } else {
        otherImports.push(node)
      }
    }

    if (dbImports.length > 0) {
      let externalEnd = 0
      for (let i = 0; i < otherImports.length; i += 1) {
        if (isExternalPackageImport(otherImports[i])) {
          externalEnd = i + 1
        }
      }

      for (const dbImport of dbImports) {
        const dbImportSource = getImportSource(dbImport)
        const dbImportRank = getInternalImportRank(dbImportSource)
        let insertAt = externalEnd

        for (let i = externalEnd; i < otherImports.length; i += 1) {
          const candidate = otherImports[i]

          if (isExternalPackageImport(candidate)) {
            continue
          }

          const candidateSource = getImportSource(candidate)
          const candidateRank = getInternalImportRank(candidateSource)
          const shouldInsertBefore =
            candidateRank > dbImportRank ||
            (candidateRank === dbImportRank && candidateSource > dbImportSource)

          if (shouldInsertBefore) {
            insertAt = i
            break
          }

          insertAt = i + 1
        }

      otherImports.splice(insertAt, 0, dbImport)
      }

      programBody.splice(0, leadingImportCount, ...otherImports)
    }

    const normalizedImportBlock = programBody
      .slice(0, leadingImportCount)
      .map((node) => {
        const source = node.source.value
        if (typeof source !== 'string') {
          return node
        }

        return cloneImportDeclaration(parser, node, source)
      })

    programBody.splice(0, leadingImportCount, ...normalizedImportBlock)

    const groupedImportSource = normalizedImportBlock
      .map((node) => {
        const source = node.source.value
        if (typeof source !== 'string') {
          return {
            group: 'external',
            text: '',
          }
        }

        const importDoc = parser('')
        importDoc.get().node.program.body = [node]

        const group = source.startsWith('.')
          ? 'relative'
          : source.startsWith('src/') || source.startsWith('api/src/')
            ? 'internal'
            : 'external'

        return {
          group,
          text: importDoc.toSource({ quote: 'single', reuseWhitespace: false }),
        }
      })
      .filter((entry) => entry.text.length > 0)

    const rebuiltImportBlock = groupedImportSource
      .map((entry, index) => {
        if (index === 0) {
          return entry.text
        }

        const previousGroup = groupedImportSource[index - 1].group
        const separator = previousGroup === entry.group ? '\n' : '\n\n'
        return separator + entry.text
      })
      .join('')

    const remainingBody = programBody.slice(leadingImportCount)
    if (remainingBody.length === 0) {
      return rebuiltImportBlock
    }

    return `${rebuiltImportBlock}${originalRemainder}`
  }

  return root.toSource({ quote: 'single', reuseWhitespace: false })
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
      filepath: dbFilePath,
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

    if (transformed === source) {
      continue
    }

    const prettified = await prettify(transformed, {
      parser: getPrettierParserForFile(file),
      filepath: file,
    })

    filesUpdated += 1
    fs.writeFileSync(file, prettified)
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
