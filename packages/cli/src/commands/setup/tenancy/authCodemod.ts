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
export const TENANCY_AUTH_EXPORT = `export const { hasRole, hasOrgRole, requireOrgAuth, requireUserAuth } =
  createTenancyAuth({ defaultRoles: ['owner', 'admin', 'member'] })
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

/**
 * Wires `api/src/lib/auth.ts` for tenancy:
 *
 * - Adds a `memberships` selection to `getCurrentUser`'s
 *   `db.user.findUnique({ ..., select: {...} })` call, so `currentUser`
 *   (both `context.currentUser` and the value sent to the web client) carries
 *   the memberships `OrgScope`, `hasOrgRole` and `resolveCurrentOrg` need.
 * - Replaces the single-tenant `hasRole` and `requireAuth` with
 *   `@cedarjs/tenancy`'s `createTenancyAuth`, which also gives `hasOrgRole`:
 *   `requireOrgAuth` checks the role in the current organization, and
 *   `requireUserAuth` what `requireAuth` did. The `AllowedRoles`
 *   type and the error imports go too when nothing else uses them.
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
    })

  if (!selectFound) {
    throw new Error('CEDAR_CODEMOD_ERR_AUTH_SHAPE_NOT_FOUND')
  }

  const alreadyWired =
    root.find(j.ImportSpecifier, { imported: { name: 'createTenancyAuth' } })
      .length > 0

  if (alreadyWired) {
    return changed ? root.toSource() : fileInfo.source
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

  return root.toSource()
}
