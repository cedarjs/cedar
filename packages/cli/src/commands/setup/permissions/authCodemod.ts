import j from 'jscodeshift'

/**
 * Imports `withPermissions` on the line after the `db` import, from beside
 * it. On the printed source rather than the AST, as recast would put a
 * blank line around a single inserted import.
 *
 * The same as in setup tenancy's `authCodemod`: jscodeshift loads each
 * transform from its source in tests, where one can't import another.
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
 * The `getCurrentUser` function, an arrow, a function expression or a
 * declaration, as a path so its returns can be told from those of
 * functions inside it
 */
function findGetCurrentUser(root: j.Collection) {
  const expression = root
    .find(j.VariableDeclarator, { id: { name: 'getCurrentUser' } })
    .map((path) => path.get('init'))
    .filter(
      (path) =>
        j.ArrowFunctionExpression.check(path.node) ||
        j.FunctionExpression.check(path.node),
    )

  return expression.size() > 0
    ? expression
    : root.find(j.FunctionDeclaration, { id: { name: 'getCurrentUser' } })
}

const isWithPermissions = (node: unknown) =>
  j.Identifier.check(node) && node.name === 'withPermissions'

/** `withPermissions(...)`, or `....then(withPermissions)` */
function isWrapped(node: unknown) {
  if (!j.CallExpression.check(node)) {
    return false
  }

  if (isWithPermissions(node.callee)) {
    return true
  }

  return (
    j.MemberExpression.check(node.callee) &&
    j.Identifier.check(node.callee.property) &&
    node.callee.property.name === 'then' &&
    isWithPermissions(node.arguments[0])
  )
}

/** `null` and `undefined` need no permissions */
function isNothing(node: unknown) {
  return (
    j.NullLiteral.check(node) ||
    (j.Identifier.check(node) && node.name === 'undefined')
  )
}

/**
 * `node`, as `getCurrentUser` returns it, passed through `withPermissions`.
 * A lookup that isn't awaited is a promise: it's awaited in an async
 * function, and gets `.then(withPermissions)` otherwise.
 */
function wrap(
  node: NonNullable<Parameters<typeof j.awaitExpression>[0]>,
  isAsync: boolean,
) {
  if (j.CallExpression.check(node)) {
    return isAsync
      ? j.callExpression(j.identifier('withPermissions'), [
          j.awaitExpression(node),
        ])
      : j.callExpression(j.memberExpression(node, j.identifier('then')), [
          j.identifier('withPermissions'),
        ])
  }

  return j.callExpression(j.identifier('withPermissions'), [node])
}

/**
 * Adds `roles: true` to the `select` of each `db.user.findUnique(...)` in
 * `getCurrentUser` that doesn't select `roles`, as the permissions come from
 * them. Returns whether it added any.
 */
function selectRoles(getCurrentUser: j.Collection) {
  let added = false

  getCurrentUser
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
      const select = j.ObjectExpression.check(args)
        ? args.properties.find(
            (prop) =>
              j.ObjectProperty.check(prop) &&
              j.Identifier.check(prop.key) &&
              prop.key.name === 'select',
          )
        : undefined

      if (
        !j.ObjectProperty.check(select) ||
        !j.ObjectExpression.check(select.value)
      ) {
        return
      }

      const hasRoles = select.value.properties.some(
        (prop) =>
          j.ObjectProperty.check(prop) &&
          j.Identifier.check(prop.key) &&
          prop.key.name === 'roles',
      )

      if (!hasRoles) {
        select.value.properties.push(
          j.objectProperty(j.identifier('roles'), j.booleanLiteral(true)),
        )
        added = true
      }
    })

  return added
}

/**
 * Wraps each user (not `null`) that `getCurrentUser` in `api/src/lib/auth`
 * returns in `withPermissions` from `api/src/lib/permissions`, once, so
 * `currentUser` carries the permissions of the user's roles, which
 * `useAuth().hasPermission()` checks on the web. With the `userHasRoles` option (the app's `User` model has
 * a `roles` field), a `db.user.findUnique` whose `select` has no `roles` gets
 * `roles: true`.
 *
 * Throws `CEDAR_CODEMOD_ERR_GET_CURRENT_USER_NOT_FOUND` when there's no
 * `getCurrentUser` that returns a user.
 */
export default function transform(
  fileInfo: j.FileInfo,
  _api: j.API,
  options: { userHasRoles?: unknown } = {},
) {
  // TS-aware, as lib/auth files have type annotations
  const root = j.withParser('tsx')(fileInfo.source)
  const getCurrentUser = findGetCurrentUser(root).at(0)
  const fn = getCurrentUser.nodes()[0]

  if (
    !j.ArrowFunctionExpression.check(fn) &&
    !j.FunctionExpression.check(fn) &&
    !j.FunctionDeclaration.check(fn)
  ) {
    throw new Error('CEDAR_CODEMOD_ERR_GET_CURRENT_USER_NOT_FOUND')
  }

  const isAsync = !!fn.async
  // Whether a returned user goes through `withPermissions`, now or before
  let wrapsAUser = false
  let changed = false

  if (j.BlockStatement.check(fn.body)) {
    getCurrentUser
      .find(j.ReturnStatement)
      // Not the returns of functions inside getCurrentUser
      .filter((path) => j(path).closest(j.Function).nodes()[0] === fn)
      .forEach((path) => {
        const argument = path.node.argument

        if (!argument || isNothing(argument)) {
          return
        }

        wrapsAUser = true

        if (!isWrapped(argument)) {
          path.node.argument = wrap(argument, isAsync)
          changed = true
        }
      })
  } else if (j.ArrowFunctionExpression.check(fn) && !isNothing(fn.body)) {
    // An arrow function's expression body
    wrapsAUser = true

    if (!isWrapped(fn.body)) {
      fn.body = wrap(fn.body, isAsync)
      changed = true
    }
  }

  if (!wrapsAUser) {
    throw new Error('CEDAR_CODEMOD_ERR_GET_CURRENT_USER_NOT_FOUND')
  }

  if (options.userHasRoles === true && selectRoles(getCurrentUser)) {
    changed = true
  }

  return addPermissionsImport(changed ? root.toSource() : fileInfo.source)
}
