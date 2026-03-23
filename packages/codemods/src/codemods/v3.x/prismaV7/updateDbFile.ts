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

  // Detect the database provider. The orchestrator passes `isSqlite` and
  // `isPostgres` via jscodeshift options. `isSqlite` defaults to true so that
  // a plain invocation (e.g. tests without options) produces the full SQLite
  // output.
  const isSqlite: boolean = options['isSqlite'] !== false
  const isPostgres: boolean = options['isPostgres'] === true

  // Idempotency: if the file already imports from the new path, skip —
  // unless this is a PostgreSQL project that still needs the adapter wired up.
  // A user who ran the old codemod (which only rewrote import paths for
  // non-SQLite providers without injecting an adapter) will already have the
  // new client path, so we must not bail out early in that case.
  const hasNewClientPath =
    root.find(j.ImportDeclaration, { source: { value: NEW_CLIENT_PATH } })
      .length > 0

  const hasPgAdapter =
    root.find(j.ImportDeclaration, { source: { value: '@prisma/adapter-pg' } })
      .length > 0

  const alreadyMigrated = hasNewClientPath && (!isPostgres || hasPgAdapter)

  if (alreadyMigrated) {
    return file.source
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Move any leading comments from `fromNode` to `toNode`.
   *
   * recast attaches file-top comments as `leadingComments` on the first AST
   * node. When we `insertBefore` that node the new import ends up above the
   * comments in the output. Stealing them first keeps the comments at the
   * top of the file.
   *
   * `node.comments` is a recast internal not exposed by jscodeshift's types,
   * hence the `as any` casts.
   */
  function stealLeadingComments(fromNode: any, toNode: any) {
    const fromComments: { leading: boolean }[] | undefined = fromNode.comments

    if (!fromComments || fromComments.length === 0) {
      return
    }

    const leading = fromComments.filter((c) => c.leading)

    if (leading.length === 0) {
      return
    }

    toNode.comments = [...leading, ...(toNode.comments ?? [])]
    fromNode.comments = fromComments.filter((c) => !c.leading)
  }

  /**
   * Insert `importDecl` immediately before the PrismaClient import declaration.
   * Falls back to inserting before the first import in the file if the client
   * import cannot be found.
   *
   * Pass `takeLeadingComments: true` for the *first* import you insert so that
   * any file-top comment block (e.g. `// See prisma docs`) is moved from the
   * client import onto the new import and therefore stays at the top of the
   * file.
   */
  function insertAdapterImport(
    importDecl: ReturnType<typeof j.importDeclaration>,
    { takeLeadingComments = false }: { takeLeadingComments?: boolean } = {},
  ) {
    const clientImport = root.find(j.ImportDeclaration, {
      source: { value: NEW_CLIENT_PATH },
    })

    if (clientImport.length > 0) {
      if (takeLeadingComments) {
        stealLeadingComments(clientImport.get().node, importDecl)
      }

      clientImport.insertBefore(importDecl)
    } else {
      root.find(j.ImportDeclaration).at(0).insertBefore(importDecl)
    }
  }

  /**
   * Ensure every `new PrismaClient(...)` call in the file receives an
   * `{ adapter }` shorthand property. Handles both the no-args case and the
   * existing-object-arg case.
   */
  function addAdapterToPrismaClient() {
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
            'name' in prop.key &&
            prop.key.name === 'adapter',
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
  }

  // -------------------------------------------------------------------------

  let didTransform = false

  // -------------------------------------------------------------------------
  // Step 1: Rewrite `import { PrismaClient } from '@prisma/client'`
  //         to      `import { PrismaClient } from 'api/db/generated/prisma/client.mts'`
  // -------------------------------------------------------------------------
  root
    .find(j.ImportDeclaration, { source: { value: OLD_PRISMA_CLIENT } })
    .forEach((nodePath) => {
      nodePath.node.source = j.stringLiteral(NEW_CLIENT_PATH)
      didTransform = true
    })

  // -------------------------------------------------------------------------
  // Step 2: Rewrite `export * from '@prisma/client'`
  //         to      `export * from 'api/db/generated/prisma/client.mts'`
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

  // For PostgreSQL, even if import paths were already rewritten by a previous
  // codemod run (so didTransform is false), we still need to proceed to inject
  // the adapter if it isn't wired up yet.
  if (!didTransform && !isPostgres) {
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
      insertAdapterImport(
        j.importDeclaration(
          [
            j.importSpecifier(
              j.identifier('PrismaPg'),
              j.identifier('PrismaPg'),
            ),
          ],
          j.stringLiteral('@prisma/adapter-pg'),
        ),
        { takeLeadingComments: true },
      )
    }

    const hasAdapter =
      root.find(j.VariableDeclarator, {
        id: { type: 'Identifier', name: 'adapter' },
      }).length > 0

    if (!hasAdapter) {
      const prismaClientDeclaration = root
        .find(j.NewExpression, {
          callee: { type: 'Identifier', name: 'PrismaClient' },
        })
        .closest(j.VariableDeclaration)

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

    addAdapterToPrismaClient()

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

  if (!hasPathImport) {
    insertAdapterImport(
      j.importDeclaration(
        [j.importDefaultSpecifier(j.identifier('path'))],
        j.stringLiteral('node:path'),
      ),
      { takeLeadingComments: true },
    )
  }

  if (!hasAdapterImport) {
    insertAdapterImport(
      j.importDeclaration(
        [
          j.importSpecifier(
            j.identifier('PrismaBetterSqlite3'),
            j.identifier('PrismaBetterSqlite3'),
          ),
        ],
        j.stringLiteral('@prisma/adapter-better-sqlite3'),
      ),
    )
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

    const clientImport = root.find(j.ImportDeclaration, {
      source: { value: NEW_CLIENT_PATH },
    })

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
  addAdapterToPrismaClient()

  return root.toSource({ quote: 'single' })
}
