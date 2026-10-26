/**
 * Moves an app from `@requireAuth` to tenancy's two auth directives:
 * `@requireOrgAuth` for fields about the current organization, and
 * `@requireUserAuth` for fields about the signed-in user.
 *
 * Before tenancy there are no organizations, so every existing
 * `@requireAuth` is about the user. These rename them all to
 * `@requireUserAuth`, which checks what `@requireAuth` did, and the app
 * moves a model's fields to `@requireOrgAuth` once the model belongs to an
 * organization.
 *
 * Plain text replacements, as these are names, not shapes: running them
 * again changes nothing.
 */

/** `source` with each `@requireAuth` directive renamed `@requireUserAuth` */
export function renameRequireAuthDirective(source: string): string {
  return source.replace(/@requireAuth(?![\w$])/g, '@requireUserAuth')
}

const LIB_AUTH_IMPORT =
  /import\s*\{([^}]*)\}\s*from\s*(['"])((?:src|\.{1,2})(?:\/[^'"]*)?\/lib\/auth(?:\.[jt]s)?)\2/g

/**
 * `source` with `requireAuth`, imported from `api/src/lib/auth`, renamed
 * `requireUserAuth`, where it's imported and where it's used. That's what
 * `requireAuth` checked, and `lib/auth` exports no `requireAuth` once
 * tenancy is set up.
 */
export function renameRequireAuthImport(source: string): string {
  let renameUses = false

  const result = source.replace(
    LIB_AUTH_IMPORT,
    (statement: string, specifiers: string) => {
      const renamed = specifiers.replace(
        /(?<![\w$])requireAuth(?![\w$])(\s+as\s+[\w$]+)?/g,
        (_specifier, alias: string | undefined) => {
          if (!alias) {
            renameUses = true
          }

          return `requireUserAuth${alias ?? ''}`
        },
      )

      return statement.replace(specifiers, renamed)
    },
  )

  if (!renameUses) {
    return result
  }

  // Every use, but not a property (`foo.requireAuth`) or the directive
  return result.replace(/(?<![\w$@.])requireAuth(?![\w$])/g, 'requireUserAuth')
}

const DEFAULT_SDL =
  'directive @requireAuth(roles: [String]) on FIELD_DEFINITION'

// The whole of \`validate\`'s body, so a check added to it counts as a change
const DEFAULT_CALL =
  /=> \{\s*const \{ roles \} = directiveArgs;?\s+applicationRequireAuth\(\{ roles \}\);?\s*\}/

/**
 * Whether `source` is the `requireAuth` directive as Cedar generates it, so
 * it can go: `@requireUserAuth` checks the same thing. A changed one is
 * left for the app to move its changes over.
 */
export function isDefaultRequireAuthDirective(source: string): boolean {
  return source.includes(DEFAULT_SDL) && DEFAULT_CALL.test(source)
}
