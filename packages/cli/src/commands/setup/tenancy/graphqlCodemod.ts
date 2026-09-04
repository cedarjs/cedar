import j from 'jscodeshift'

/**
 * The `context` option added to `createGraphQLHandler({ ... })`, built by
 * parsing a throwaway object literal instead of nesting jscodeshift builders
 * by hand for a function this size.
 */
function buildContextProperty() {
  const snippet = `
    const __tenancySnippet = {
      context: async ({ context: gqlContext }) => {
        const { currentUser, event, request, params } = gqlContext

        // A user whose getCurrentUser result doesn't carry memberships
        // can't be matched to an organization, so the request runs with
        // no current organization set.
        if (!isUserWithMemberships(currentUser)) {
          return {}
        }

        // Yoga can populate either \`event\` (Lambda-style deployments) or
        // \`request\` (Fetch-API-style deployments); resolveCurrentOrg reads
        // the organization header off either.
        const requestEvent = event ?? request

        if (!requestEvent) {
          return {}
        }

        const currentOrg = await resolveCurrentOrg({
          event: requestEvent,
          variables: params.variables,
          currentUser,
          lookupOrg: async (idOrSlug) =>
            (await db.organization.findUnique({
              where: { id: idOrSlug },
              select: { id: true, slug: true },
            })) ??
            db.organization.findUnique({
              where: { slug: idOrSlug },
              select: { id: true, slug: true },
            }),
        })

        return { currentOrg }
      },
    }
  `

  // Parsed with a TypeScript-aware parser so the node matches the AST of the
  // target file, which is parsed the same way below.
  const property = j
    .withParser('ts')(snippet)
    .find(j.ObjectProperty, { key: { name: 'context' } })
    .nodes()[0]

  if (!property) {
    // Unreachable: the snippet above is a fixed literal.
    throw new Error('RW_CODEMOD_ERR_GRAPHQL_HANDLER_NOT_FOUND')
  }

  return property
}

function addNamedImport(
  root: ReturnType<typeof j>,
  names: string[],
  source: string,
) {
  const imports = root.find(j.ImportDeclaration)

  imports.at(-1).insertAfter(
    j.importDeclaration(
      names.map((name) => j.importSpecifier(j.identifier(name))),
      j.literal(source),
    ),
  )
}

/**
 * Wires `api/src/functions/graphql.ts` for tenancy: adds the
 * `resolveCurrentOrg` import (from `@cedarjs/tenancy`) and a `context` option
 * to `createGraphQLHandler({ ... })` that resolves the request's current
 * organization before every resolver runs.
 *
 * Throws `RW_CODEMOD_ERR_GRAPHQL_HANDLER_NOT_FOUND` when
 * `createGraphQLHandler({ ... })` cannot be found, and
 * `RW_CODEMOD_ERR_GRAPHQL_CONTEXT_EXISTS` when a `context` option is already
 * present (most likely hand-written), so the caller can print instructions
 * instead of overwriting app code.
 */
export default function transform(fileInfo: j.FileInfo) {
  // Parse with the TS-aware parser: real db.ts/auth.ts/graphql.ts files
  // commonly have type annotations, `import type`, interfaces or generics,
  // which the default (non-TS) babel parser bound to the top-level `j`
  // can't parse.
  const root = j.withParser('tsx')(fileInfo.source)

  const handlerCalls = root.find(j.CallExpression, {
    callee: { name: 'createGraphQLHandler' },
  })

  if (handlerCalls.length === 0) {
    throw new Error('RW_CODEMOD_ERR_GRAPHQL_HANDLER_NOT_FOUND')
  }

  handlerCalls.forEach((path) => {
    const [config] = path.node.arguments

    if (!j.ObjectExpression.check(config)) {
      throw new Error('RW_CODEMOD_ERR_GRAPHQL_HANDLER_NOT_FOUND')
    }

    const hasContext = config.properties.some(
      (prop) =>
        j.ObjectProperty.check(prop) &&
        j.Identifier.check(prop.key) &&
        prop.key.name === 'context',
    )

    if (hasContext) {
      throw new Error('RW_CODEMOD_ERR_GRAPHQL_CONTEXT_EXISTS')
    }

    config.properties.push(buildContextProperty())
  })

  addNamedImport(
    root,
    ['isUserWithMemberships', 'resolveCurrentOrg'],
    '@cedarjs/tenancy',
  )

  return root.toSource()
}
