import j from 'jscodeshift'

/**
 * A parsed `memberships: { select: { ... } }` property, built by parsing a
 * throwaway object literal instead of nesting `j.objectProperty`/
 * `j.objectExpression` calls by hand three levels deep.
 */
function buildMembershipsSelectProperty() {
  const snippet = `
    const __tenancySnippet = {
      memberships: {
        select: {
          id: true,
          organizationId: true,
          role: true,
          organization: { select: { id: true, slug: true, name: true } },
        },
      },
    }
  `

  // The default parser bound to the top-level `j` enables babel's `estree`
  // plugin, which normalizes object properties to ESTree `Property` nodes
  // instead of Babel's `ObjectProperty`; `.find(j.ObjectProperty, ...)`
  // below would never match against that tree, so parse with `ts` instead.
  const property = j
    .withParser('ts')(snippet)
    .find(j.ObjectProperty, { key: { name: 'memberships' } })
    .nodes()[0]

  if (!property) {
    // Unreachable: the snippet above is a fixed literal.
    throw new Error('CEDAR_CODEMOD_ERR_AUTH_SHAPE_NOT_FOUND')
  }

  return property
}

/**
 * What replaces the app's `hasRole` and `requireAuth`. `defaultRoles` are
 * the roles `organizations.ts`'s `ROLE_GRANTS` generates: a field that
 * lists no roles admits only these, so a role an app adds later is refused
 * until a field lets it in.
 */
export const TENANCY_AUTH_EXPORT = `export const { hasRole, requireAuth, hasOrgRole } = createTenancyAuth({
  defaultRoles: ['owner', 'admin', 'member'],
})
`

/** The top-level `export const <name> = ...` statement, if there is one */
function findExportedConst(root: j.Collection, name: string) {
  return root.find(j.ExportNamedDeclaration, {
    declaration: {
      type: 'VariableDeclaration',
      declarations: [{ id: { type: 'Identifier', name } }],
    },
  })
}

const USER_LOOKUP = {
  callee: {
    type: 'MemberExpression',
    object: {
      type: 'MemberExpression',
      object: { name: 'db' },
      property: { name: 'user' },
    },
    property: { name: 'findUnique' },
  },
} as const

/**
 * Wraps `getCurrentUser`'s `db.user.findUnique(...)` in `withPermissions`
 * from `api/src/lib/permissions`, so each membership the web gets carries
 * its permissions (`useAuth().hasPermission()`). A lookup that's already wrapped is left
 * alone.
 */
function addWithPermissions(root: j.Collection) {
  const isWithPermissionsCall = (node: unknown) =>
    j.CallExpression.check(node) &&
    j.Identifier.check(node.callee) &&
    node.callee.name === 'withPermissions'

  root.find(j.CallExpression, USER_LOOKUP).forEach((path) => {
    const awaited = j.AwaitExpression.check(path.parent.node)
      ? path.parent
      : null

    if (isWithPermissionsCall((awaited ?? path).parent.node)) {
      return
    }

    if (awaited) {
      awaited.replace(
        j.callExpression(j.identifier('withPermissions'), [awaited.node]),
      )
    } else {
      // `return db.user.findUnique(...)`, a promise
      path.replace(
        j.callExpression(j.memberExpression(path.node, j.identifier('then')), [
          j.identifier('withPermissions'),
        ]),
      )
    }
  })
}

/**
 * Imports `withPermissions` on the line after the `db` import, from beside
 * it. On the printed source rather than the AST, as recast would put a
 * blank line around a single inserted import.
 */
function addPermissionsImport(source: string): string {
  if (/import \{[^}]*\bwithPermissions\b[^}]*\} from/.test(source)) {
    return source
  }

  const dbImport = /^import \{ db \} from (['"])(.*?)db(\.js)?\1;?\n/m

  if (dbImport.test(source)) {
    return source.replace(
      dbImport,
      (line, quote, dir, ext = '') =>
        `${line}import { withPermissions } from ${quote}${dir}permissions${ext}${quote}\n`,
    )
  }

  return `import { withPermissions } from 'src/lib/permissions'\n${source}`
}

/**
 * Wires `api/src/lib/auth.ts` for tenancy:
 *
 * - Adds a `memberships` selection to `getCurrentUser`'s
 *   `db.user.findUnique({ ..., select: {...} })` call, so `currentUser`
 *   (both `context.currentUser` and the value sent to the web client) carries
 *   the memberships `OrgScope`, `hasOrgRole` and `resolveCurrentOrg` need.
 * - Replaces the single-tenant `hasRole` and `requireAuth` with
 *   `@cedarjs/tenancy`'s `createTenancyAuth`, which also gives `hasOrgRole`:
 *   roles come from the membership in the current organization, and
 *   `requireAuth` needs one unless told `scope: 'USER'`. The `AllowedRoles`
 *   type and the error imports go too when nothing else uses them.
 * - Wraps the user lookup in `withPermissions`, so each membership carries
 *   its permissions from `api/src/lib/permissions`.
 *
 * Throws `CEDAR_CODEMOD_ERR_AUTH_SHAPE_NOT_FOUND` when `db.user.findUnique`'s
 * `select` object cannot be located, and
 * `CEDAR_CODEMOD_ERR_AUTH_CHECKS_NOT_FOUND` when `hasRole` and
 * `requireAuth` aren't both there to replace, so the caller can print the
 * snippet to add by hand instead of guessing at an unfamiliar shape.
 */
export default function transform(fileInfo: j.FileInfo) {
  // Parse with the TS-aware parser: real db.ts/auth.ts/graphql.ts files
  // commonly have type annotations, `import type`, interfaces or generics,
  // which the default (non-TS) babel parser bound to the top-level `j`
  // can't parse.
  const root = j.withParser('tsx')(fileInfo.source)

  let selectFound = false

  root
    .find(j.CallExpression, {
      callee: {
        type: 'MemberExpression',
        object: {
          type: 'MemberExpression',
          object: { name: 'db' },
          property: { name: 'user' },
        },
        property: { name: 'findUnique' },
      },
    })
    .forEach((path) => {
      const [args] = path.node.arguments

      if (!j.ObjectExpression.check(args)) {
        return
      }

      const selectProperty = args.properties.find(
        (prop) =>
          j.ObjectProperty.check(prop) &&
          j.Identifier.check(prop.key) &&
          prop.key.name === 'select',
      )

      if (
        !selectProperty ||
        !j.ObjectProperty.check(selectProperty) ||
        !j.ObjectExpression.check(selectProperty.value)
      ) {
        return
      }

      const alreadyHasMemberships = selectProperty.value.properties.some(
        (prop) =>
          j.ObjectProperty.check(prop) &&
          j.Identifier.check(prop.key) &&
          prop.key.name === 'memberships',
      )

      if (!alreadyHasMemberships) {
        selectProperty.value.properties.push(buildMembershipsSelectProperty())
      }

      selectFound = true
    })

  if (!selectFound) {
    throw new Error('CEDAR_CODEMOD_ERR_AUTH_SHAPE_NOT_FOUND')
  }

  addWithPermissions(root)

  const alreadyWired =
    root.find(j.ImportSpecifier, { imported: { name: 'createTenancyAuth' } })
      .length > 0

  if (alreadyWired) {
    return addPermissionsImport(root.toSource())
  }

  const hasRole = findExportedConst(root, 'hasRole')
  const requireAuth = findExportedConst(root, 'requireAuth')

  if (hasRole.length !== 1 || requireAuth.length !== 1) {
    throw new Error('CEDAR_CODEMOD_ERR_AUTH_CHECKS_NOT_FOUND')
  }

  const tenancyAuth = j
    .withParser('ts')(TENANCY_AUTH_EXPORT)
    .find(j.ExportNamedDeclaration)
    .nodes()[0]

  // In place of `requireAuth`, so it stays where the app's other code
  // expects it; `hasRole` just goes
  requireAuth.replaceWith(tenancyAuth)
  hasRole.remove()

  // Used anywhere but in its own declaration (an import, or a type alias)
  const isUnused = (name: string) =>
    root
      .find(j.Identifier, { name })
      .filter(
        (path) =>
          !j.ImportSpecifier.check(path.parent.node) &&
          !j.TSTypeAliasDeclaration.check(path.parent.node),
      ).length === 0

  root
    .find(j.TSTypeAliasDeclaration, { id: { name: 'AllowedRoles' } })
    .filter(() => isUnused('AllowedRoles'))
    .remove()

  root
    .find(j.ImportDeclaration, { source: { value: '@cedarjs/graphql-server' } })
    .forEach((path) => {
      path.node.specifiers = (path.node.specifiers ?? []).filter(
        (specifier) =>
          !j.ImportSpecifier.check(specifier) ||
          !j.Identifier.check(specifier.local) ||
          !isUnused(specifier.local.name),
      )
    })
    .filter((path) => (path.node.specifiers ?? []).length === 0)
    .remove()

  const tenancyImport = j
    .withParser('ts')(`import { createTenancyAuth } from '@cedarjs/tenancy'\n`)
    .find(j.ImportDeclaration)
    .nodes()[0]

  const imports = root.find(j.ImportDeclaration)
  const cedarImports = imports.filter((path) =>
    String(path.node.source.value).startsWith('@cedarjs/'),
  )
  const anchor = cedarImports.length > 0 ? cedarImports : imports

  if (anchor.length > 0) {
    anchor.at(anchor.length - 1).insertAfter(tenancyImport)
  } else {
    root.find(j.Program).forEach((path) => {
      path.node.body.unshift(tenancyImport)
    })
  }

  return addPermissionsImport(root.toSource())
}
