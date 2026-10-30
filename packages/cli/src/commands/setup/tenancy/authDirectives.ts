/**
 * Moves an app from `@requireAuth` to tenancy's auth directives:
 * `@requirePermission` for fields about the current organization, and
 * `@requireUserAuth` for fields about the signed-in user.
 *
 * Before tenancy there are no organizations, so every existing
 * `@requireAuth` is about the user. These rename them all to
 * `@requireUserAuth`, which checks what `@requireAuth` did, and the app
 * moves a model's fields to `@requirePermission` once the model belongs to
 * an organization.
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
 * What `api/src/lib/auth` exported before tenancy, and what checks the same
 * thing once it's set up
 */
const LIB_AUTH_RENAMES = {
  requireAuth: 'requireUserAuth',
  hasRole: 'hasUserRole',
} as const

/**
 * `source` with `requireAuth` and `hasRole`, imported from
 * `api/src/lib/auth`, renamed `requireUserAuth` and `hasUserRole`, where
 * they're imported and where they're used. Those check what the old ones
 * did, and `lib/auth` exports neither old name once tenancy is set up.
 */
export function renameLibAuthImports(source: string): string {
  let result = source

  for (const [from, to] of Object.entries(LIB_AUTH_RENAMES)) {
    let renameUses = false

    result = result.replace(
      LIB_AUTH_IMPORT,
      (statement: string, specifiers: string) => {
        const renamed = specifiers.replace(
          new RegExp(`(?<![\\w$])${from}(?![\\w$])(\\s+as\\s+[\\w$]+)?`, 'g'),
          (_specifier, alias: string | undefined) => {
            if (!alias) {
              renameUses = true
            }

            return `${to}${alias ?? ''}`
          },
        )

        return statement.replace(specifiers, renamed)
      },
    )

    if (renameUses) {
      // Every use, but not a property (`auth.requireAuth`) or a directive
      result = result.replace(
        new RegExp(`(?<![\\w$@.])${from}(?![\\w$])`, 'g'),
        to,
      )
    }
  }

  return result
}

/**
 * The `requireAuth` directive as `create-cedar-app` generates it, in
 * TypeScript and JavaScript. The tests check these against its templates.
 */
export const DEFAULT_REQUIRE_AUTH_DIRECTIVES = [
  `import { gql } from 'graphql-tag'

import type { ValidatorDirectiveFunc } from '@cedarjs/graphql-server'
import { createValidatorDirective } from '@cedarjs/graphql-server'

import { requireAuth as applicationRequireAuth } from 'src/lib/auth'

export const schema = gql\`
  """
  Use to check whether or not a user is authenticated and is associated
  with an optional set of roles.
  """
  directive @requireAuth(roles: [String]) on FIELD_DEFINITION
\`

type RequireAuthValidate = ValidatorDirectiveFunc<{ roles?: string[] }>

const validate: RequireAuthValidate = ({ directiveArgs }) => {
  const { roles } = directiveArgs
  applicationRequireAuth({ roles })
}

const requireAuth = createValidatorDirective(schema, validate)

export default requireAuth
`,
  `import { gql } from 'graphql-tag'

import { createValidatorDirective } from '@cedarjs/graphql-server'

import { requireAuth as applicationRequireAuth } from 'src/lib/auth'

export const schema = gql\`
  """
  Use to check whether or not a user is authenticated and is associated
  with an optional set of roles.
  """
  directive @requireAuth(roles: [String]) on FIELD_DEFINITION
\`

const validate = ({ directiveArgs }) => {
  const { roles } = directiveArgs
  applicationRequireAuth({ roles })
}

const requireAuth = createValidatorDirective(schema, validate)

export default requireAuth
`,
]

/**
 * `source` without what formatting changes: comments, whitespace,
 * semicolons, trailing commas and the kind of quotes
 */
function withoutFormatting(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
    .replace(/["']/g, "'")
    .replace(/[;\s]/g, '')
    .replace(/,([)\]}>])/g, '$1')
}

/**
 * Whether `source` is the `requireAuth` directive as Cedar generates it,
 * however it's been formatted since, so it can go: `@requireUserAuth`
 * checks the same thing. Anything else, a check added to `validate` or a
 * wrapper around the export, counts as the app's own and is left for it to
 * move over.
 */
export function isDefaultRequireAuthDirective(source: string): boolean {
  return DEFAULT_REQUIRE_AUTH_DIRECTIVES.some(
    (directive) => withoutFormatting(directive) === withoutFormatting(source),
  )
}
