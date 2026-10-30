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
 *   the memberships the web side's tenancy and `resolveCurrentOrg` need.
 * - Wraps the user lookup in `withPermissions`, so each membership carries
 *   its permissions from `api/src/lib/permissions`.
 *
 * Throws `CEDAR_CODEMOD_ERR_AUTH_SHAPE_NOT_FOUND` when `db.user.findUnique`'s
 * `select` object cannot be located.
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

  return addPermissionsImport(changed ? root.toSource() : fileInfo.source)
}
