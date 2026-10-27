import j from 'jscodeshift'

const TENANCY_MODULE = 'src/tenancy'
const TENANCY_WEB = '@cedarjs/tenancy/web'

/**
 * Passes the app's `tenancy` (`web/src/tenancy`) to its `<Router>` in
 * `web/src/Routes`, next to `useAuth`, so the router renders the
 * organization provider and checks `<PrivateSet orgRoles>` and
 * `<PrivateSet orgPermission>`:
 *
 *   import { tenancy } from 'src/tenancy'
 *
 *   <Router useAuth={useAuth} tenancy={tenancy}>
 *
 * A `useOrgRoles` prop on the `<Router>` is replaced by `tenancy` in place, and
 * the `useOrgRoles` import from `@cedarjs/tenancy/web` is removed, together
 * with its declaration when it is the only specifier, since `@cedarjs/tenancy/web`
 * has no `useOrgRoles`. Otherwise it adds only what isn't there yet, so a file
 * that already has `tenancy` stays as it is. Throws `CEDAR_CODEMOD_ERR_ROUTER_NOT_FOUND` unless there's exactly one
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
  let hasProp = attributes.some(
    (attribute) =>
      j.JSXAttribute.check(attribute) && attribute.name.name === 'tenancy',
  )

  const hasImport =
    root.find(j.ImportSpecifier, { local: { name: 'tenancy' } }).length > 0

  const tenancyProp = () =>
    j.jsxAttribute(
      j.jsxIdentifier('tenancy'),
      j.jsxExpressionContainer(j.identifier('tenancy')),
    )

  let removedOld = false

  const oldPropIndex = attributes.findIndex(
    (attribute) =>
      j.JSXAttribute.check(attribute) && attribute.name.name === 'useOrgRoles',
  )

  if (oldPropIndex !== -1) {
    removedOld = true

    if (hasProp) {
      attributes.splice(oldPropIndex, 1)
    } else {
      attributes.splice(oldPropIndex, 1, tenancyProp())
      hasProp = true
    }

    router.attributes = attributes
  }

  root
    .find(j.ImportDeclaration, { source: { value: TENANCY_WEB } })
    .forEach((declaration) => {
      const specifiers = declaration.node.specifiers ?? []
      const kept = specifiers.filter(
        (specifier) =>
          !(
            j.ImportSpecifier.check(specifier) &&
            specifier.imported.name === 'useOrgRoles'
          ),
      )

      if (kept.length === specifiers.length) {
        return
      }

      removedOld = true

      if (kept.length === 0) {
        j(declaration).remove()
      } else {
        declaration.node.specifiers = kept
      }
    })

  if (hasProp && hasImport && !removedOld) {
    return fileInfo.source
  }

  if (!hasProp) {
    const useAuthIndex = attributes.findIndex(
      (attribute) =>
        j.JSXAttribute.check(attribute) && attribute.name.name === 'useAuth',
    )

    const prop = tenancyProp()

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
