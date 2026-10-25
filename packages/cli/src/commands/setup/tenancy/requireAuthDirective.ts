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

/** The test case auth setup writes for a `requireAuth` without tenancy */
const SIGNED_IN_TEST_CASE =
  /\n {2}it\('does not throw when there is a current user', \(\) => \{\n[\s\S]*?\n {2}\}\)\n/

const tenancyTestCases = (typescript: boolean) => `
  it('throws when there is no current organization', () => {
    const mockExecution = mockRedwoodDirective(requireAuth, {
      context: { currentUser: asCurrentUser({ id: 1, memberships: [] }) },
    })

    expect(mockExecution).toThrowError(
      'You must be a member of an organization to do that.',
    )
  })

  it('does not throw for a member of the current organization', () => {
    // The mocked user should have the same shape as what getCurrentUser()
    // in api/src/lib/auth returns
    const mockExecution = mockRedwoodDirective(requireAuth, {
      context: {
        currentUser: asCurrentUser({ id: 1, memberships: [] }),
        currentOrg: {
          id: 'org-1',
          slug: 'org-1',
          role: 'member',
          membershipId: 'membership-1',
        },
      },
    })

    expect(mockExecution).not.toThrowError()
  })

  it('does not need an organization with scope: USER', () => {
    const mockExecution = mockRedwoodDirective(requireAuth, {
      context: { currentUser: asCurrentUser({ id: 1, memberships: [] }) },
      directiveArgs: { scope: 'USER'${typescript ? ' as const' : ''} },
    })

    expect(mockExecution).not.toThrowError()
  })
`

const asCurrentUserHelper = (typescript: boolean) =>
  typescript
    ? `
/**
 * \`context.currentUser\` is typed from this app's \`getCurrentUser\`, which
 * selects more fields than these tests need.
 */
const asCurrentUser = (user: { id: number; memberships: unknown[] }) =>
  user as unknown as NonNullable<typeof context.currentUser>
`
    : `
const asCurrentUser = (user) => user
`

/**
 * The \`requireAuth\` directive test with its signed-in case replaced by
 * cases for the organization scope, or \`undefined\` when the test doesn't
 * have the case auth setup writes (it's been changed, or it's already
 * updated).
 */
export function updateRequireAuthTest(
  source: string,
  { typescript }: { typescript: boolean },
): string | undefined {
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  const normalized = source.replaceAll('\r\n', '\n')

  if (!SIGNED_IN_TEST_CASE.test(normalized)) {
    return undefined
  }

  const importLine = /(import requireAuth from '[^']+'\n)/

  if (!importLine.test(normalized)) {
    return undefined
  }

  return normalized
    .replace(SIGNED_IN_TEST_CASE, tenancyTestCases(typescript))
    .replace(importLine, `$1${asCurrentUserHelper(typescript)}`)
    .replaceAll('\n', eol)
}
