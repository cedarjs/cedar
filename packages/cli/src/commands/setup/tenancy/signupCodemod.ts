import j from 'jscodeshift'

/**
 * Renames the `userAttributes` property in the handler's param destructure
 * back to its shorthand form (`userAttributes`) when the scaffolded dbAuth
 * template aliased it to `_userAttributes` (the underscore is there only to
 * silence unused-var lint since the stub body never read it; the codemod is
 * about to add the first read).
 *
 * `fn` is typed structurally (not as a specific ast-types node interface) so
 * this helper works for both arrow functions and function expressions
 * without importing `ast-types` directly as a dependency of this package.
 */
function useShorthandUserAttributes(fn: { params: unknown[] }): void {
  const [firstParam] = fn.params

  if (!j.ObjectPattern.check(firstParam)) {
    throw new Error('RW_CODEMOD_ERR_SIGNUP_SHAPE_NOT_FOUND')
  }

  const userAttributesProperty = firstParam.properties.find(
    (prop) =>
      j.ObjectProperty.check(prop) &&
      j.Identifier.check(prop.key) &&
      prop.key.name === 'userAttributes',
  )

  if (
    !userAttributesProperty ||
    !j.ObjectProperty.check(userAttributesProperty)
  ) {
    throw new Error('RW_CODEMOD_ERR_SIGNUP_SHAPE_NOT_FOUND')
  }

  userAttributesProperty.value = j.identifier('userAttributes')
  userAttributesProperty.shorthand = true
}

/**
 * Adds an optional `invitationToken?: string` member to a local
 * `interface UserAttributes { ... }` declaration, when one exists, so the
 * `userAttributes.invitationToken` read this codemod adds type-checks. Does
 * nothing when there is no such interface (the JS variant of this file has
 * no types at all, and a hand-written file may type `userAttributes`
 * differently) rather than guessing at an unfamiliar shape.
 */
function addInvitationTokenToUserAttributes(root: ReturnType<typeof j>): void {
  root
    .find(j.TSInterfaceDeclaration, { id: { name: 'UserAttributes' } })
    .forEach((path) => {
      const alreadyHasField = path.node.body.body.some(
        (member) =>
          j.TSPropertySignature.check(member) &&
          j.Identifier.check(member.key) &&
          member.key.name === 'invitationToken',
      )

      if (alreadyHasField) {
        return
      }

      path.node.body.body.push(
        j.tsPropertySignature(
          j.identifier('invitationToken'),
          j.tsTypeAnnotation(j.tsStringKeyword()),
          true, // optional
        ),
      )
    })
}

/**
 * Wraps the `db.user.create(...)` call in `signupOptions.handler` so a new
 * signup also gets a default organization (or claims a pending invitation):
 *
 *   handler: async ({ ... , userAttributes }) => {
 *     const user = await db.user.create({ ... })
 *     await ensureDefaultOrganization({
 *       currentUser: { id: user.id, memberships: [] },
 *       invitationToken: userAttributes.invitationToken,
 *     })
 *     return user
 *   }
 *
 * `currentUser` is built as `{ id, memberships: [] }` rather than passed as
 * `user` directly: `db.user.create(...)`'s result has no `memberships`
 * field, and an empty array is always correct here since a user that was
 * just created cannot have any memberships yet.
 */
function wrapCreateCall(fn: { async?: boolean; body: unknown }): void {
  fn.async = true

  const ensureCallStatement = j.expressionStatement(
    j.awaitExpression(
      j.callExpression(j.identifier('ensureDefaultOrganization'), [
        j.objectExpression([
          j.objectProperty(
            j.identifier('currentUser'),
            j.objectExpression([
              j.objectProperty(
                j.identifier('id'),
                j.memberExpression(j.identifier('user'), j.identifier('id')),
              ),
              j.objectProperty(
                j.identifier('memberships'),
                j.arrayExpression([]),
              ),
            ]),
          ),
          j.objectProperty(
            j.identifier('invitationToken'),
            j.memberExpression(
              j.identifier('userAttributes'),
              j.identifier('invitationToken'),
            ),
          ),
        ]),
      ]),
    ),
  )

  const returnUserStatement = j.returnStatement(j.identifier('user'))

  if (j.BlockStatement.check(fn.body)) {
    const returnIndex = fn.body.body.findIndex((statement) =>
      j.ReturnStatement.check(statement),
    )

    const returnStatement = fn.body.body[returnIndex]

    if (
      returnIndex === -1 ||
      !j.ReturnStatement.check(returnStatement) ||
      !returnStatement.argument
    ) {
      throw new Error('RW_CODEMOD_ERR_SIGNUP_SHAPE_NOT_FOUND')
    }

    const createUserStatement = j.variableDeclaration('const', [
      j.variableDeclarator(
        j.identifier('user'),
        j.awaitExpression(returnStatement.argument),
      ),
    ])

    fn.body.body.splice(
      returnIndex,
      1,
      createUserStatement,
      ensureCallStatement,
      returnUserStatement,
    )

    return
  }

  if (j.Expression.check(fn.body)) {
    const createUserStatement = j.variableDeclaration('const', [
      j.variableDeclarator(
        j.identifier('user'),
        j.awaitExpression(
          // ast-types' `Expression` checker type isn't assignable to
          // `awaitExpression`'s narrower `ExpressionKind` union (a gap in
          // ast-types' generated types); the `check()` call above already
          // guarantees `fn.body` is a valid expression node.
          fn.body as Parameters<typeof j.awaitExpression>[0],
        ),
      ),
    ])

    fn.body = j.blockStatement([
      createUserStatement,
      ensureCallStatement,
      returnUserStatement,
    ])

    return
  }

  throw new Error('RW_CODEMOD_ERR_SIGNUP_SHAPE_NOT_FOUND')
}

/**
 * Wires dbAuth's `api/src/functions/auth.ts` signup handler for tenancy:
 * after the new user is created, it gets a default organization, or claims
 * the pending invitation named by the signup form's
 * `userAttributes.invitationToken`.
 *
 * Throws `RW_CODEMOD_ERR_SIGNUP_SHAPE_NOT_FOUND` when `signupOptions.handler`
 * cannot be located or does not have the expected
 * `({ ..., userAttributes }) => { ...; return <expr> }` shape, so the caller
 * can print the snippet to add by hand instead of guessing.
 */
export default function transform(fileInfo: j.FileInfo) {
  // Parse with the TS-aware parser: real db.ts/auth.ts/graphql.ts files
  // commonly have type annotations, `import type`, interfaces or generics,
  // which the default (non-TS) babel parser bound to the top-level `j`
  // can't parse.
  const root = j.withParser('tsx')(fileInfo.source)

  const signupOptionsDeclarators = root.find(j.VariableDeclarator, {
    id: { name: 'signupOptions' },
  })

  if (signupOptionsDeclarators.length === 0) {
    throw new Error('RW_CODEMOD_ERR_SIGNUP_SHAPE_NOT_FOUND')
  }

  let handlerFound = false

  signupOptionsDeclarators.forEach((path) => {
    const init = path.node.init

    if (!j.ObjectExpression.check(init)) {
      return
    }

    const handlerProperty = init.properties.find(
      (prop) =>
        j.ObjectProperty.check(prop) &&
        j.Identifier.check(prop.key) &&
        prop.key.name === 'handler',
    )

    if (!handlerProperty || !j.ObjectProperty.check(handlerProperty)) {
      return
    }

    const handlerFn = handlerProperty.value

    if (
      !j.ArrowFunctionExpression.check(handlerFn) &&
      !j.FunctionExpression.check(handlerFn)
    ) {
      return
    }

    useShorthandUserAttributes(handlerFn)
    wrapCreateCall(handlerFn)
    handlerFound = true
  })

  if (!handlerFound) {
    throw new Error('RW_CODEMOD_ERR_SIGNUP_SHAPE_NOT_FOUND')
  }

  addInvitationTokenToUserAttributes(root)

  const imports = root.find(j.ImportDeclaration)
  imports
    .at(-1)
    .insertAfter(
      j.importDeclaration(
        [j.importSpecifier(j.identifier('ensureDefaultOrganization'))],
        j.literal('src/services/organizations/organizations'),
      ),
    )

  return root.toSource()
}
