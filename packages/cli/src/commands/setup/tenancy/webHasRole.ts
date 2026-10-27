/**
 * Moves an app's web side from `useAuth().hasRole` to `useAuth().hasUserRole`.
 *
 * With tenancy, every role check says which kind it is, and `hasRole` isn't
 * in the app's types any more. Before tenancy there are no organizations, so
 * every existing `hasRole` check is about `currentUser.roles`: that's what
 * `hasUserRole` checks.
 *
 * Plain text replacements of the common forms, as these are names, not
 * shapes: running them again changes nothing. Anything else is left for the
 * type checker to point out.
 */

const HAS_ROLE = /(?<![\w$])hasRole(?![\w$])/

/** `const { ..., hasRole, ... } = useAuth()`, with `{` and `}` matched */
const USE_AUTH_DESTRUCTURING = /\{([^{}]*)\}(\s*=\s*useAuth\(\))/g

/** `const auth = useAuth()`, capturing `auth` */
const USE_AUTH_VARIABLE = /(?:const|let|var)\s+([\w$]+)\s*=\s*useAuth\(\)/g

/** `name.hasRole` or `name?.hasRole`, capturing `name` and what follows it */
const HAS_ROLE_ON_VARIABLE = /(?<![\w$.])([\w$]+)(\s*\??\.\s*)hasRole(?![\w$])/g

/**
 * `source` with `hasRole` from `useAuth()` renamed `hasUserRole`:
 *
 * - `useAuth().hasRole(...)`
 * - `const { hasRole } = useAuth()`, and the uses of `hasRole` after it
 *   (`const { hasRole: check } = useAuth()` keeps `check`)
 * - `auth.hasRole(...)`, where `const auth = useAuth()`
 */
export function renameUseAuthHasRole(source: string): string {
  if (!source.includes('useAuth()') || !HAS_ROLE.test(source)) {
    return source
  }

  let renameUses = false

  let result = source.replace(
    /(useAuth\(\)\s*\??\.\s*)hasRole(?![\w$])/g,
    '$1hasUserRole',
  )

  result = result.replace(
    USE_AUTH_DESTRUCTURING,
    (_statement: string, specifiers: string, rest: string) => {
      const renamed = specifiers.replace(
        /(?<![\w$])hasRole(?![\w$])(\s*:)?/g,
        (_specifier, alias: string | undefined) => {
          if (!alias) {
            renameUses = true
          }

          return `hasUserRole${alias ?? ''}`
        },
      )

      return `{${renamed}}${rest}`
    },
  )

  if (renameUses) {
    // Every use, but not a property (`other.hasRole`)
    result = result.replace(/(?<![\w$.])hasRole(?![\w$])/g, 'hasUserRole')
  }

  const authVariables = new Set(
    Array.from(source.matchAll(USE_AUTH_VARIABLE), ([, name]) => name),
  )

  if (authVariables.size === 0) {
    return result
  }

  return result.replace(
    HAS_ROLE_ON_VARIABLE,
    (match: string, name: string, access: string) =>
      authVariables.has(name) ? `${name}${access}hasUserRole` : match,
  )
}
