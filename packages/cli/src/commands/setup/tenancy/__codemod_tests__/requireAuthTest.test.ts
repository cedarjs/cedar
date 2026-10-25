import { describe, expect, it } from 'vitest'

import { updateRequireAuthTest } from '../requireAuthDirective.js'

const AUTH_SETUP_TEST = `import { mockRedwoodDirective, getDirectiveName } from '@cedarjs/testing/api'

import requireAuth from './requireAuth.js'

describe('requireAuth directive', () => {
  it('declares the directive sdl as schema, with the correct name', () => {
    expect(requireAuth.schema).toBeTruthy()
    expect(getDirectiveName(requireAuth.schema)).toBe('requireAuth')
  })

  it('throws when there is no current user', () => {
    const mockExecution = mockRedwoodDirective(requireAuth, { context: {} })

    expect(mockExecution).toThrowError("You don't have permission to do that.")
  })

  it('does not throw when there is a current user', () => {
    // The mocked user should have the same shape as what getCurrentUser()
    // in api/src/lib/auth returns
    const mockExecution = mockRedwoodDirective(requireAuth, {
      context: { currentUser: { id: 1 } },
    })

    expect(mockExecution).not.toThrowError()
  })
})
`

describe('updateRequireAuthTest', () => {
  it('replaces the signed-in case with organization cases', () => {
    const result = updateRequireAuthTest(AUTH_SETUP_TEST, { typescript: true })

    expect(result).toBeDefined()
    expect(result).not.toContain(
      "'does not throw when there is a current user'",
    )
    expect(result).toContain("it('throws when there is no current user'")
    expect(result).toContain(
      "it('throws when there is no current organization'",
    )
    expect(result).toContain(
      "it('does not throw for a member of the current organization'",
    )
    expect(result).toContain("directiveArgs: { scope: 'USER' as const }")
    expect(result).toContain(
      "import requireAuth from './requireAuth.js'\n\n/**\n * `context.currentUser`",
    )
  })

  it('writes plain JavaScript for a JavaScript project', () => {
    const result = updateRequireAuthTest(AUTH_SETUP_TEST, {
      typescript: false,
    })

    expect(result).toContain('const asCurrentUser = (user) => user')
    expect(result).not.toContain('as unknown')
    expect(result).not.toContain('as const')
  })

  it("leaves a test without auth setup's signed-in case alone", () => {
    const updated = updateRequireAuthTest(AUTH_SETUP_TEST, {
      typescript: true,
    })

    expect(updateRequireAuthTest(updated!, { typescript: true })).toBe(
      undefined,
    )
  })

  it('keeps Windows line endings', () => {
    const result = updateRequireAuthTest(
      AUTH_SETUP_TEST.replaceAll('\n', '\r\n'),
      { typescript: true },
    )

    expect(result).toContain('\r\n')
    expect(result?.replaceAll('\r\n', '')).not.toContain('\n')
  })
})
