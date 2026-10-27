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

/** What replaces the app's `hasRole` and `requireAuth` */
export const TENANCY_AUTH_EXPORT = `export const { hasUserRole, hasOrgRole, requireUserAuth, requireOrgAuth } =
  createTenancyAuth()
`

/**
 * The statements Cedar's generated `requireAuth` is made of, across auth
 * providers, without comments and with whitespace collapsed
 */
const DEFAULT_REQUIRE_AUTH_STATEMENTS = [
  /^if \(!isAuthenticated\(\)\) \{ throw new AuthenticationError\([^)]*\);? \}$/,
  /^if \(roles && !hasRole\(roles\)\) \{ throw new ForbiddenError\([^)]*\);? \}$/,
  /^return isAuthenticated\(\);?$/,
]

/**
 * Every name Cedar's generated `hasRole` uses, across auth providers. One
 * that uses any other, such as a `suspended` field, has checks of its own.
 */
const DEFAULT_HAS_ROLE_NAMES = new Set([
  'AllowedRoles',
  'Array',
  'allowedRole',
  'allowedRoles',
  'context',
  'currentUser',
  'currentUserRoles',
  'hasRole',
  'includes',
  'isArray',
  'isAuthenticated',
  'role',
  'roles',
  'some',
  'undefined',
])

/** The value an `export const <name> = ...` statement exports */
function exportedValue(declaration: j.Collection) {
  const node = declaration.nodes()[0]

  return j.VariableDeclaration.check(node?.declaration)
    ? node.declaration.declarations[0]
    : undefined
}

/**
 * Whether `hasRole` (its `export const` statement) does only what Cedar's
 * generated one does, so replacing it loses nothing
 */
function isDefaultHasRole(hasRole: j.Collection) {
  return hasRole
    .find(j.Identifier)
    .nodes()
    .every((identifier) => DEFAULT_HAS_ROLE_NAMES.has(identifier.name))
}

/**
 * Whether `requireAuth` (its `export const` statement) does only what
 * Cedar's generated one does, so replacing it loses nothing: an app's own
 * check in it, such as refusing suspended users, or a wrapper around it,
 * would silently go
 */
function isDefaultRequireAuth(requireAuth: j.Collection) {
  const declarator = exportedValue(requireAuth)
  const fn = j.VariableDeclarator.check(declarator) ? declarator.init : null

  if (
    !j.ArrowFunctionExpression.check(fn) ||
    !j.BlockStatement.check(fn.body)
  ) {
    return false
  }

  return fn.body.body.every((statement) => {
    const source = j(statement)
      .toSource()
      .replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, ' ')
      .trim()

    return DEFAULT_REQUIRE_AUTH_STATEMENTS.some((pattern) =>
      pattern.test(source),
    )
  })
}

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
 * Imports `context` from `@cedarjs/context` when the file uses it but
 * nothing declares it. On the api side `context` is a global, but the web
 * side type-checks this file too (for `currentUser`'s type), and there the
 * global only came along with the `@cedarjs/graphql-server` import, which
 * goes once `AuthenticationError` and `ForbiddenError` are unused.
 */
function addContextImport(root: j.Collection): boolean {
  const usesContext =
    root
      .find(j.Identifier, { name: 'context' })
      .filter(
        (path) =>
          !(
            j.MemberExpression.check(path.parent.node) &&
            path.parent.node.property === path.node &&
            !path.parent.node.computed
          ) &&
          !(
            j.ObjectProperty.check(path.parent.node) &&
            path.parent.node.key === path.node
          ),
      ).length > 0

  const declaresContext =
    root.find(j.ImportDeclaration, {
      source: { value: '@cedarjs/graphql-server' },
    }).length > 0 ||
    root.find(j.ImportSpecifier, { local: { name: 'context' } }).length > 0 ||
    root.find(j.VariableDeclarator, { id: { name: 'context' } }).length > 0

  if (!usesContext || declaresContext) {
    return false
  }

  const contextImport = j
    .withParser('ts')(`import { context } from '@cedarjs/context'\n`)
    .find(j.ImportDeclaration)
    .nodes()[0]

  const cedarImports = root
    .find(j.ImportDeclaration)
    .filter((path) => String(path.node.source.value).startsWith('@cedarjs/'))
  const before = cedarImports.filter(
    (path) => String(path.node.source.value) > '@cedarjs/context',
  )

  if (before.length > 0) {
    before.at(0).insertBefore(contextImport)
  } else if (cedarImports.length > 0) {
    cedarImports.at(cedarImports.length - 1).insertAfter(contextImport)
  } else {
    root.find(j.Program).forEach((path) => {
      path.node.body.unshift(contextImport)
    })
  }

  return true
}

/**
 * Wraps `getCurrentUser`'s `db.user.findUnique(...)` in `withPermissions`
 * from `api/src/lib/permissions`, so each membership the web gets carries
 * its permissions (`useAuth().hasPermission()`). A lookup that's already wrapped is left
 * alone.
 */
function addWithPermissions(
  root: j.Collection,
  lookups: ReadonlySet<unknown>,
): boolean {
  const isWithPermissionsCall = (node: unknown) =>
    j.CallExpression.check(node) &&
    j.Identifier.check(node.callee) &&
    node.callee.name === 'withPermissions'

  let wrapped = false

  root.find(j.CallExpression, USER_LOOKUP).forEach((path) => {
    // Only lookups that select the memberships `withPermissions` reads
    if (!lookups.has(path.node)) {
      return
    }

    const awaited = j.AwaitExpression.check(path.parent.node)
      ? path.parent
      : null

    // `withPermissions(await ...)`, or `....then(withPermissions)` when the
    // lookup isn't awaited
    const thenCall = path.parent.parent?.node
    const isThenWithPermissions =
      j.MemberExpression.check(path.parent.node) &&
      j.Identifier.check(path.parent.node.property) &&
      path.parent.node.property.name === 'then' &&
      j.CallExpression.check(thenCall) &&
      j.Identifier.check(thenCall.arguments[0]) &&
      thenCall.arguments[0].name === 'withPermissions'

    if (
      isWithPermissionsCall((awaited ?? path).parent.node) ||
      isThenWithPermissions
    ) {
      return
    }

    wrapped = true

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

  return wrapped
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

  // The file's own line endings: CRLF when git checks it out on Windows
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  const dbImport = /^import \{ db \} from (['"])(.*?)db(\.js)?\1;?\r?\n/m

  if (dbImport.test(source)) {
    return source.replace(
      dbImport,
      (line, quote, dir, ext = '') =>
        `${line}import { withPermissions } from ${quote}${dir}permissions${ext}${quote}${eol}`,
    )
  }

  return `import { withPermissions } from 'src/lib/permissions'${eol}${source}`
}

/**
 * Wires `api/src/lib/auth.ts` for tenancy:
 *
 * - Adds a `memberships` selection to `getCurrentUser`'s
 *   `db.user.findUnique({ ..., select: {...} })` call, so `currentUser`
 *   (both `context.currentUser` and the value sent to the web client) carries
 *   the memberships the web side's tenancy, `hasOrgRole` and
 *   `resolveCurrentOrg` need.
 * - Replaces the single-tenant `hasRole` and `requireAuth` with
 *   `@cedarjs/tenancy`'s `createTenancyAuth`, which also gives `hasOrgRole`:
 *   `requireOrgAuth` checks the role in the current organization, and
 *   `requireUserAuth` what `requireAuth` did. The `AllowedRoles`
 *   type and the error imports go too when nothing else uses them.
 * - Wraps the user lookup in `withPermissions`, so each membership carries
 *   its permissions from `api/src/lib/permissions`.
 *
 * Throws `CEDAR_CODEMOD_ERR_AUTH_SHAPE_NOT_FOUND` when `db.user.findUnique`'s
 * `select` object cannot be located,
 * `CEDAR_CODEMOD_ERR_AUTH_CHECKS_NOT_FOUND` when `hasRole` and
 * `requireAuth` aren't both there to replace, and
 * `CEDAR_CODEMOD_ERR_AUTH_CHECKS_CHANGED` when `requireAuth` or `hasRole`
 * does more than Cedar's, so the caller can print the snippet to add by hand instead of
 * guessing at an unfamiliar shape or dropping the app's own checks.
 */
export default function transform(fileInfo: j.FileInfo) {
  // Parse with the TS-aware parser: real db.ts/auth.ts/graphql.ts files
  // commonly have type annotations, `import type`, interfaces or generics,
  // which the default (non-TS) babel parser bound to the top-level `j`
  // can't parse.
  const root = j.withParser('tsx')(fileInfo.source)

  let selectFound = false
  // The `db.user.findUnique` calls whose `select` has `memberships`
  const membershipLookups = new Set<unknown>()
  // Whether this run adds anything. When it doesn't, the file is returned
  // as it was, rather than reprinted (which, e.g., changes CRLF line endings)
  let changed = false

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
        changed = true
      }

      selectFound = true
      membershipLookups.add(path.node)
    })

  if (!selectFound) {
    throw new Error('CEDAR_CODEMOD_ERR_AUTH_SHAPE_NOT_FOUND')
  }

  if (addWithPermissions(root, membershipLookups)) {
    changed = true
  }

  const alreadyWired =
    root.find(j.ImportSpecifier, { imported: { name: 'createTenancyAuth' } })
      .length > 0

  if (alreadyWired) {
    if (addContextImport(root)) {
      changed = true
    }

    return addPermissionsImport(changed ? root.toSource() : fileInfo.source)
  }

  const hasRole = findExportedConst(root, 'hasRole')
  const requireAuth = findExportedConst(root, 'requireAuth')

  if (hasRole.length !== 1 || requireAuth.length !== 1) {
    throw new Error('CEDAR_CODEMOD_ERR_AUTH_CHECKS_NOT_FOUND')
  }

  if (!isDefaultRequireAuth(requireAuth) || !isDefaultHasRole(hasRole)) {
    throw new Error('CEDAR_CODEMOD_ERR_AUTH_CHECKS_CHANGED')
  }

  const tenancyAuth = j
    .withParser('ts')(TENANCY_AUTH_EXPORT)
    .find(j.ExportNamedDeclaration)
    .nodes()[0]

  // In place of `requireAuth`, so it stays where the app's other code
  // expects it; `hasRole` just goes
  requireAuth.replaceWith(tenancyAuth)
  hasRole.remove()

  // Anything else in the file that used `hasRole` gets `hasUserRole`, which
  // checks the same thing
  root
    .find(j.Identifier, { name: 'hasRole' })
    .filter(
      (path) =>
        !(
          j.MemberExpression.check(path.parent.node) &&
          path.parent.node.property === path.node
        ),
    )
    .forEach((path) => {
      path.node.name = 'hasUserRole'
    })

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

  addContextImport(root)

  return addPermissionsImport(root.toSource())
}
