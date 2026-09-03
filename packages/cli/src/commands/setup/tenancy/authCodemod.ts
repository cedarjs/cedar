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
    throw new Error('RW_CODEMOD_ERR_AUTH_SHAPE_NOT_FOUND')
  }

  return property
}

/**
 * Wires `api/src/lib/auth.ts` for tenancy:
 *
 * - Adds a `memberships` selection to `getCurrentUser`'s
 *   `db.user.findUnique({ ..., select: {...} })` call, so `currentUser`
 *   (both `context.currentUser` and the value sent to the web client) carries
 *   the memberships `OrgScope`, `hasOrgRole` and `resolveCurrentOrg` need.
 * - Re-exports `hasOrgRole` and `requireMembership` from `@cedarjs/tenancy`,
 *   so app code can `import { hasOrgRole, requireMembership } from
 *   'src/lib/auth'` the same way it already imports `requireAuth`.
 *
 * Throws `RW_CODEMOD_ERR_AUTH_SHAPE_NOT_FOUND` when `db.user.findUnique`'s
 * `select` object cannot be located, so the caller can print the snippet to
 * add by hand instead of guessing at an unfamiliar shape.
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
    throw new Error('RW_CODEMOD_ERR_AUTH_SHAPE_NOT_FOUND')
  }

  const tenancyExportSnippet = `export { hasOrgRole, requireMembership } from '@cedarjs/tenancy'\n`
  const tenancyExport = j
    .withParser('ts')(tenancyExportSnippet)
    .find(j.ExportNamedDeclaration)
    .nodes()[0]

  root.find(j.Program).forEach((path) => {
    path.node.body.push(tenancyExport)
  })

  return root.toSource()
}
