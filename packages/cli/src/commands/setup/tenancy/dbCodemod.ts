import j from 'jscodeshift'

const DEFAULT_GLOBAL_MODELS = ['user', 'organization', 'membership']

/**
 * Wraps `api/src/lib/db.ts`'s `db` export in `@cedarjs/tenancy`'s Prisma
 * extension:
 *
 *   export const db = prismaClient.$extends(
 *     createTenancyExtension<typeof prismaClient>({
 *       models: { allExcept: ['user', 'organization', 'membership'] },
 *     }),
 *   )
 *
 * Chains onto an existing `$extends` call (e.g. from `setup uploads`)
 * instead of replacing it, the same way every extension setup command does.
 * Throws `RW_CODEMOD_ERR_OLD_FORMAT` when `db` is still `new PrismaClient()`
 * inline (pre-v8 shape) and `RW_CODEMOD_ERR_DB_SHAPE_NOT_FOUND` when no `db`
 * export is found at all.
 *
 * `options.tenantField`, when set, is emitted as the extension's
 * `tenantField` option; it is passed through `runTransform`'s `options` to
 * this transform's third argument, jscodeshift's per-run options object.
 */
export default function transform(
  fileInfo: j.FileInfo,
  _api: j.API,
  options: j.Options,
) {
  // Parse with the TS-aware parser: real db.ts/auth.ts/graphql.ts files
  // commonly have type annotations, `import type`, interfaces or generics,
  // which the default (non-TS) babel parser bound to the top-level `j`
  // can't parse.
  const root = j.withParser('tsx')(fileInfo.source)

  const tenantField =
    typeof options.tenantField === 'string' ? options.tenantField : undefined

  const imports = root.find(j.ImportDeclaration)
  imports
    .at(-1) // add it after the last one
    .insertAfter(
      j.importDeclaration(
        [j.importSpecifier(j.identifier('createTenancyExtension'))],
        j.literal('@cedarjs/tenancy'),
      ),
    )

  const configProperties = [
    ...(tenantField
      ? [
          j.objectProperty(
            j.identifier('tenantField'),
            j.stringLiteral(tenantField),
          ),
        ]
      : []),
    j.objectProperty(
      j.identifier('models'),
      j.objectExpression([
        j.objectProperty(
          j.identifier('allExcept'),
          j.arrayExpression(
            DEFAULT_GLOBAL_MODELS.map((name) => j.stringLiteral(name)),
          ),
        ),
      ]),
    ),
  ]

  let found = false

  root
    .find(j.VariableDeclaration, { declarations: [{ id: { name: 'db' } }] })
    .forEach((path) => {
      const dbDeclaration = path.node.declarations[0]

      if (!j.VariableDeclarator.check(dbDeclaration)) {
        return
      }

      if (j.NewExpression.check(dbDeclaration.init)) {
        throw new Error('RW_CODEMOD_ERR_OLD_FORMAT')
      }

      if (!j.Expression.check(dbDeclaration.init)) {
        return
      }

      found = true

      const extensionCall = j.callExpression(
        j.identifier('createTenancyExtension'),
        [j.objectExpression(configProperties)],
      )

      dbDeclaration.init = j.callExpression(
        j.memberExpression(dbDeclaration.init, j.identifier('$extends')),
        [extensionCall],
      )
    })

  if (!found) {
    throw new Error('RW_CODEMOD_ERR_DB_SHAPE_NOT_FOUND')
  }

  // jscodeshift's TypeScript builders for generic type arguments are
  // unwieldy to get right (the field name and node shape vary by ast-types
  // version); `createTenancyExtension(` only ever appears once, at the call
  // site we just inserted, so a targeted string replace is simpler and just
  // as safe as building the `<typeof prismaClient>` node by hand.
  return root
    .toSource()
    .replace(
      'createTenancyExtension(',
      'createTenancyExtension<typeof prismaClient>(',
    )
}
