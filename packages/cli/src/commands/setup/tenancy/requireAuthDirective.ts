/**
 * Gives the app's `@requireAuth` directive
 * (`api/src/directives/requireAuth/requireAuth.{ts,js}`) the `scope`
 * argument tenancy's `requireAuth` takes: `@requireAuth` is about the
 * current organization, `@requireAuth(scope: USER)` about the signed-in user
 * alone.
 *
 * Plain text replacements on the generated file's three spots (the SDL, the
 * validate function's type, and its call), as the file is small and
 * app-owned: when one can't be found the file has been changed, and
 * `CEDAR_TENANCY_ERR_DIRECTIVE_SHAPE_NOT_FOUND` is thrown so the caller can
 * print `REQUIRE_AUTH_DIRECTIVE_SNIPPET` instead. Running it again changes
 * nothing.
 */

const SDL = 'directive @requireAuth(roles: [String]) on FIELD_DEFINITION'

const SCOPED_SDL = `directive @requireAuth(
    roles: [String]
    scope: AuthScope = ORGANIZATION
  ) on FIELD_DEFINITION

  """
  What a @requireAuth check is about.
  """
  enum AuthScope {
    "The current organization: the user must be a member, and roles are their role in it (the default)"
    ORGANIZATION
    "The signed-in user, in any organization or none: their account, their memberships"
    USER
  }`

const CALL =
  /const \{ roles \} = directiveArgs(\s+)applicationRequireAuth\(\{ roles \}\)/

const VALIDATE_TYPE = 'ValidatorDirectiveFunc<{ roles?: string[] }>'

export const REQUIRE_AUTH_DIRECTIVE_SNIPPET = `
  export const schema = gql\`
    ${SCOPED_SDL}
  \`

  const validate = ({ directiveArgs }) => {
    const { roles, scope } = directiveArgs
    applicationRequireAuth({ roles, scope })
  }
`

export function addScopeToRequireAuthDirective(source: string): string {
  if (/\benum AuthScope\b/.test(source)) {
    return source
  }

  if (!source.includes(SDL) || !CALL.test(source)) {
    throw new Error('CEDAR_TENANCY_ERR_DIRECTIVE_SHAPE_NOT_FOUND')
  }

  let result = source
    .replace(SDL, SCOPED_SDL)
    .replace(
      CALL,
      'const { roles, scope } = directiveArgs$1applicationRequireAuth({ roles, scope })',
    )

  // TypeScript projects only
  if (result.includes(VALIDATE_TYPE)) {
    result = result.replace(
      VALIDATE_TYPE,
      `ValidatorDirectiveFunc<{ roles?: string[]; scope?: AuthScope }>`,
    )
    result = result.replace(
      /(import \{ createValidatorDirective \} from '@cedarjs\/graphql-server'\n)/,
      `$1import type { AuthScope } from '@cedarjs/tenancy'\n`,
    )
  }

  return result
}
