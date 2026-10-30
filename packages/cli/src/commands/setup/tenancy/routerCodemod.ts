import j from 'jscodeshift'

const TENANCY_MODULE = 'src/tenancy'

/**
 * Passes the app's `tenancy` (`web/src/tenancy`) to its `<Router>` in
 * `web/src/Routes`, next to `useAuth`, so the router renders the
 * organization provider and checks `<PrivateSet orgPermission>`:
 *
 *   import { tenancy } from 'src/tenancy'
 *
 *   <Router useAuth={useAuth} tenancy={tenancy}>
 *
 * Adds only what isn't there yet, so a file from an earlier run stays as it
 * is. Throws `CEDAR_CODEMOD_ERR_ROUTER_NOT_FOUND` unless there's exactly one
 * `<Router>`, so the caller can tell the user to add the prop by hand
 * instead of guessing.
 */
export default function transform(fileInfo: j.FileInfo) {
  const root = j.withParser('tsx')(fileInfo.source)

  const routers = root.find(j.JSXOpeningElement, { name: { name: 'Router' } })

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
      j.JSXAttribute.check(attribute) && attribute.name.name === 'tenancy',
  )

  const hasImport =
    root.find(j.ImportSpecifier, { local: { name: 'tenancy' } }).length > 0

  if (hasProp && hasImport) {
    return fileInfo.source
  }

  if (!hasProp) {
    const useAuthIndex = attributes.findIndex(
      (attribute) =>
        j.JSXAttribute.check(attribute) && attribute.name.name === 'useAuth',
    )

    const prop = j.jsxAttribute(
      j.jsxIdentifier('tenancy'),
      j.jsxExpressionContainer(j.identifier('tenancy')),
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
    root
      .find(j.ImportDeclaration)
      .at(-1)
      .insertAfter(
        j.importDeclaration(
          [j.importSpecifier(j.identifier('tenancy'))],
          j.literal(TENANCY_MODULE),
        ),
      )
  }

  return root.toSource()
}
