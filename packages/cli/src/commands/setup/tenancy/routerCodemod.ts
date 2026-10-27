import j from 'jscodeshift'

const TENANCY_WEB = '@cedarjs/tenancy/web'

/**
 * The name `Router` from `@cedarjs/router` has in this file: `Router`, or
 * what it's imported as
 */
function routerLocalName(root: ReturnType<typeof j>): string | undefined {
  let localName: string | undefined

  root
    .find(j.ImportDeclaration, { source: { value: '@cedarjs/router' } })
    .find(j.ImportSpecifier, { imported: { name: 'Router' } })
    .forEach((path) => {
      const local = path.node.local
      localName = j.Identifier.check(local) ? local.name : 'Router'
    })

  return localName
}

/**
 * Passes `useOrgRoles` from `@cedarjs/tenancy/web` to the app's `<Router>`
 * in `web/src/Routes`, next to `useAuth`, so `<PrivateSet orgRoles>` can
 * check the user's role in the route's organization:
 *
 *   import { useOrgRoles } from '@cedarjs/tenancy/web'
 *
 *   <Router useAuth={useAuth} useOrgRoles={useOrgRoles}>
 *
 * Adds only what isn't there yet, so a file from an earlier run stays as it
 * is. Throws `CEDAR_CODEMOD_ERR_ROUTER_NOT_FOUND` unless there's exactly one
 * `<Router>` from `@cedarjs/router`, so the caller can tell the user to add
 * the prop by hand instead of guessing.
 */
export default function transform(fileInfo: j.FileInfo) {
  const root = j.withParser('tsx')(fileInfo.source)

  const routerName = routerLocalName(root)

  if (!routerName) {
    throw new Error('CEDAR_CODEMOD_ERR_ROUTER_NOT_FOUND')
  }

  const routers = root.find(j.JSXOpeningElement, {
    name: { name: routerName },
  })

  if (routers.length !== 1) {
    throw new Error('CEDAR_CODEMOD_ERR_ROUTER_NOT_FOUND')
  }

  const router = routers.get().node

  if (!j.JSXOpeningElement.check(router)) {
    throw new Error('CEDAR_CODEMOD_ERR_ROUTER_NOT_FOUND')
  }

  const attributes = router.attributes ?? []
  const hasProp = attributes.some(
    (attribute) =>
      j.JSXAttribute.check(attribute) && attribute.name.name === 'useOrgRoles',
  )

  const hasImport =
    root.find(j.ImportSpecifier, { local: { name: 'useOrgRoles' } }).length > 0

  if (hasProp && hasImport) {
    return fileInfo.source
  }

  if (!hasProp) {
    const useAuthIndex = attributes.findIndex(
      (attribute) =>
        j.JSXAttribute.check(attribute) && attribute.name.name === 'useAuth',
    )

    const prop = j.jsxAttribute(
      j.jsxIdentifier('useOrgRoles'),
      j.jsxExpressionContainer(j.identifier('useOrgRoles')),
    )

    // Right after `useAuth`, or else last
    attributes.splice(
      useAuthIndex === -1 ? attributes.length : useAuthIndex + 1,
      0,
      prop,
    )
    router.attributes = attributes
  }

  if (!hasImport) {
    const specifier = j.importSpecifier(j.identifier('useOrgRoles'))
    // An import of other names from it, to add this one to: not a type-only
    // or namespace import
    const tenancyImport = root
      .find(j.ImportDeclaration, { source: { value: TENANCY_WEB } })
      .nodes()
      .find(
        (declaration) =>
          declaration.importKind !== 'type' &&
          declaration.specifiers?.every((existing) =>
            j.ImportSpecifier.check(existing),
          ),
      )

    if (tenancyImport?.specifiers) {
      tenancyImport.specifiers.push(specifier)
    } else {
      root
        .find(j.ImportDeclaration)
        .at(-1)
        .insertAfter(j.importDeclaration([specifier], j.literal(TENANCY_WEB)))
    }
  }

  return root.toSource()
}
