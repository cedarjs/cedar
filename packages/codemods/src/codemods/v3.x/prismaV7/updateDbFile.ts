import type { API, FileInfo, Options } from 'jscodeshift'

// The generated client path for Prisma v7
const NEW_CLIENT_PATH = 'api/db/generated/prisma/client.mts'

// Old paths that should be rewritten
const OLD_PRISMA_CLIENT = '@prisma/client'

export default function transform(
  file: FileInfo,
  api: API,
  options: Options = {},
): string {
  const j = api.jscodeshift
  const root = j(file.source)

  // Idempotency: if the file already imports from the new path, skip
  const alreadyMigrated =
    root.find(j.ImportDeclaration, { source: { value: NEW_CLIENT_PATH } })
      .length > 0

  if (alreadyMigrated) {
    return file.source
  }

  // Detect the database provider. The orchestrator passes `isSqlite` and
  // `isPostgres` via jscodeshift options. `isSqlite` defaults to true so that
  // a plain invocation (e.g. tests without options) produces the full SQLite
  // output.
  const isSqlite: boolean = options['isSqlite'] !== false
  const isPostgres: boolean = options['isPostgres'] === true

  let didTransform = false

  // -------------------------------------------------------------------------
  // Step 1: Rewrite `import { PrismaClient } from '@prisma/client'`
  //         to     `import { PrismaClient } from 'api/db/generated/prisma/client.mts'`
  // -------------------------------------------------------------------------
  root
    .find(j.ImportDeclaration, { source: { value: OLD_PRISMA_CLIENT } })
    .forEach((nodePath) => {
      nodePath.node.source = j.stringLiteral(NEW_CLIENT_PATH)
      didTransform = true
    })

  // -------------------------------------------------------------------------
  // Step 2: Rewrite `export * from '@prisma/client'`
  //         to     `export * from 'api/db/generated/prisma/client.mts'`
  //         Also handle `export * from 'src/lib/db'` (set by the prep codemod)
  // -------------------------------------------------------------------------
  root
    .find(j.ExportAllDeclaration)
    .filter((nodePath) => {
      const src = nodePath.node.source?.value
      return (
        src === OLD_PRISMA_CLIENT ||
        src === 'src/lib/db' ||
        src === 'api/src/lib/db'
      )
    })
    .forEach((nodePath) => {
      nodePath.node.source = j.stringLiteral(NEW_CLIENT_PATH)
      didTransform = true
    })

  if (!didTransform) {
    return file.source
  }

  if (isPostgres) {
    // -----------------------------------------------------------------------
    // PostgreSQL path: add PrismaPg import, adapter constant, and pass it to
    // PrismaClient.
    // -----------------------------------------------------------------------

    const hasAdapterImport =
      root.find(j.ImportDeclaration, {
        source: { value: '@prisma/adapter-pg' },
      }).length > 0

    if (!hasAdapterImport) {
      const clientImport = root.find(j.ImportDeclaration, {
        source: { value: NEW_CLIENT_PATH },
      })

      const adapterImport = j.importDeclaration(
        [j.importSpecifier(j.identifier('PrismaPg'), j.identifier('PrismaPg'))],
        j.stringLiteral('@prisma/adapter-pg'),
      )

      clientImport.insertBefore(adapterImport)
    }

    const hasAdapter =
      root.find(j.VariableDeclarator, {
        id: { type: 'Identifier', name: 'adapter' },
      }).length > 0

    const prismaClientNewExpr = root.find(j.NewExpression, {
      callee: { type: 'Identifier', name: 'PrismaClient' },
    })

    if (prismaClientNewExpr.length > 0 && !hasAdapter) {
      const prismaClientDeclaration = prismaClientNewExpr.closest(
        j.VariableDeclaration,
      )

      // const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
      const adapterDecl = j.variableDeclaration('const', [
        j.variableDeclarator(
          j.identifier('adapter'),
          j.newExpression(j.identifier('PrismaPg'), [
            j.objectExpression([
              j.objectProperty(
                j.identifier('connectionString'),
                j.memberExpression(
                  j.memberExpression(
                    j.identifier('process'),
                    j.identifier('env'),
                  ),
                  j.identifier('DATABASE_URL'),
                ),
              ),
            ]),
          ]),
        ),
      ])

      prismaClientDeclaration.insertBefore(adapterDecl)
    }

    // Add `adapter` property to new PrismaClient({...})
    root
      .find(j.NewExpression, {
        callee: { type: 'Identifier', name: 'PrismaClient' },
      })
      .forEach((nodePath) => {
        const args = nodePath.node.arguments

        if (args.length === 0) {
          nodePath.node.arguments = [
            j.objectExpression([
              Object.assign(
                j.objectProperty(
                  j.identifier('adapter'),
                  j.identifier('adapter'),
                ),
                { shorthand: true },
              ),
            ]),
          ]
          return
        }

        const firstArg = args[0]

        if (firstArg.type !== 'ObjectExpression') {
          return
        }

        const hasAdapterProp = firstArg.properties.some(
          (prop) =>
            prop.type === 'ObjectProperty' &&
            prop.key.type === 'Identifier' &&
            (prop.key as any).name === 'adapter',
        )

        if (!hasAdapterProp) {
          firstArg.properties.push(
            Object.assign(
              j.objectProperty(
                j.identifier('adapter'),
                j.identifier('adapter'),
              ),
              { shorthand: true },
            ),
          )
        }
      })

    return root.toSource({ quote: 'single' })
  }

  if (!isSqlite) {
    // For other non-SQLite projects, only rewrite the import paths.
    // The user needs to add their own driver adapter.
    return root.toSource({ quote: 'single' })
  }

  // -------------------------------------------------------------------------
  // Step 3 (SQLite only): Add new imports if not already present
  //   import path from 'node:path'
  //   import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
  //   import { getPaths } from '@cedarjs/project-config'
  // -------------------------------------------------------------------------
  const hasPathImport =
    root.find(j.ImportDeclaration, { source: { value: 'node:path' } }).length >
    0

  const hasAdapterImport =
    root.find(j.ImportDeclaration, {
      source: { value: '@prisma/adapter-better-sqlite3' },
    }).length > 0

  const hasGetPathsImport =
    root.find(j.ImportDeclaration, {
      source: { value: '@cedarjs/project-config' },
    }).length > 0

  const allImports = root.find(j.ImportDeclaration)
  const firstImport = allImports.at(0)

  if (!hasPathImport) {
    const pathImport = j.importDeclaration(
      [j.importDefaultSpecifier(j.identifier('path'))],
      j.stringLiteral('node:path'),
    )
    firstImport.insertBefore(pathImport)
  }

  // Find the new client import (which we just rewrote) and insert adapter
  // import before it
  const clientImport = root.find(j.ImportDeclaration, {
    source: { value: NEW_CLIENT_PATH },
  })

  if (!hasAdapterImport) {
    const adapterImport = j.importDeclaration(
      [
        j.importSpecifier(
          j.identifier('PrismaBetterSqlite3'),
          j.identifier('PrismaBetterSqlite3'),
        ),
      ],
      j.stringLiteral('@prisma/adapter-better-sqlite3'),
    )
    clientImport.insertBefore(adapterImport)
  }

  if (!hasGetPathsImport) {
    // Insert getPaths import after the last @cedarjs/* import
    const cedarjsImports = root.find(j.ImportDeclaration, (node) =>
      String(node.source.value).startsWith('@cedarjs/'),
    )

    const getPathsImport = j.importDeclaration(
      [j.importSpecifier(j.identifier('getPaths'), j.identifier('getPaths'))],
      j.stringLiteral('@cedarjs/project-config'),
    )

    if (cedarjsImports.length > 0) {
      cedarjsImports.at(-1).insertAfter(getPathsImport)
    } else {
      clientImport.insertAfter(getPathsImport)
    }
  }

  // -------------------------------------------------------------------------
  // Step 4 (SQLite only): Insert `resolveSqliteUrl` and `adapter` constants
  //   before the `new PrismaClient(...)` expression.
  //
  //   We build these by parsing source strings so the output matches the
  //   canonical template exactly, avoiding AST-builder quoting/spacing quirks.
  // -------------------------------------------------------------------------
  const hasResolveSqliteUrl =
    root.find(j.VariableDeclarator, {
      id: { type: 'Identifier', name: 'resolveSqliteUrl' },
    }).length > 0

  const hasAdapter =
    root.find(j.VariableDeclarator, {
      id: { type: 'Identifier', name: 'adapter' },
    }).length > 0

  const prismaClientNewExpr = root.find(j.NewExpression, {
    callee: { type: 'Identifier', name: 'PrismaClient' },
  })

  if (prismaClientNewExpr.length > 0 && (!hasResolveSqliteUrl || !hasAdapter)) {
    const prismaClientDeclaration = prismaClientNewExpr.closest(
      j.VariableDeclaration,
    )

    if (!hasResolveSqliteUrl) {
      // Parse the helper function from a source string to get correct AST
      // output without fighting j.templateLiteral / j.memberExpression quirks.
      const resolveSqliteUrlSource = `
const resolveSqliteUrl = (url = 'file:./db/dev.db') => {
  if (!url.startsWith('file:.')) {
    return url
  }

  return \`file:\${path.resolve(getPaths().api.base, url.slice('file:'.length))}\`
}
`
      const resolveSqliteUrlDecl = j(resolveSqliteUrlSource)
        .find(j.VariableDeclaration)
        .get().node

      prismaClientDeclaration.insertBefore(resolveSqliteUrlDecl)
    }

    if (!hasAdapter) {
      // Build:
      // const adapter = new PrismaBetterSqlite3({
      //   url: resolveSqliteUrl(process.env.DATABASE_URL),
      // })
      const adapterDecl = j.variableDeclaration('const', [
        j.variableDeclarator(
          j.identifier('adapter'),
          j.newExpression(j.identifier('PrismaBetterSqlite3'), [
            j.objectExpression([
              j.objectProperty(
                j.identifier('url'),
                j.callExpression(j.identifier('resolveSqliteUrl'), [
                  j.memberExpression(
                    j.memberExpression(
                      j.identifier('process'),
                      j.identifier('env'),
                    ),
                    j.identifier('DATABASE_URL'),
                  ),
                ]),
              ),
            ]),
          ]),
        ),
      ])

      prismaClientDeclaration.insertBefore(adapterDecl)
    }
  }

  // -------------------------------------------------------------------------
  // Step 5 (SQLite only): Add `adapter` property to `new PrismaClient({...})`
  // -------------------------------------------------------------------------
  root
    .find(j.NewExpression, {
      callee: { type: 'Identifier', name: 'PrismaClient' },
    })
    .forEach((nodePath) => {
      const args = nodePath.node.arguments

      if (args.length === 0) {
        // new PrismaClient() → new PrismaClient({ adapter })
        nodePath.node.arguments = [
          j.objectExpression([
            Object.assign(
              j.objectProperty(
                j.identifier('adapter'),
                j.identifier('adapter'),
              ),
              { shorthand: true },
            ),
          ]),
        ]
        return
      }

      const firstArg = args[0]

      if (firstArg.type !== 'ObjectExpression') {
        return
      }

      // Check if adapter property already exists
      const hasAdapterProp = firstArg.properties.some(
        (prop) =>
          prop.type === 'ObjectProperty' &&
          prop.key.type === 'Identifier' &&
          (prop.key as any).name === 'adapter',
      )

      if (!hasAdapterProp) {
        firstArg.properties.push(
          Object.assign(
            j.objectProperty(j.identifier('adapter'), j.identifier('adapter')),
            { shorthand: true },
          ),
        )
      }
    })

  return root.toSource({ quote: 'single' })
}
