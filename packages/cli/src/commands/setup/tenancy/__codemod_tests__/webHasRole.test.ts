import dedent from 'ts-dedent'
import { describe, expect, it } from 'vitest'

import { renameUseAuthHasRole } from '../webHasRole.js'

describe('renameUseAuthHasRole', () => {
  it('renames a destructured hasRole and its uses', () => {
    const source = dedent`
      import { useAuth } from 'src/auth'

      const Nav = () => {
        const { isAuthenticated, hasRole } = useAuth()

        return isAuthenticated && hasRole(['admin']) ? <AdminLink /> : null
      }
    `

    expect(renameUseAuthHasRole(source)).toBe(dedent`
      import { useAuth } from 'src/auth'

      const Nav = () => {
        const { isAuthenticated, hasUserRole } = useAuth()

        return isAuthenticated && hasUserRole(['admin']) ? <AdminLink /> : null
      }
    `)
  })

  it('keeps an alias', () => {
    const source = dedent`
      const { hasRole: can } = useAuth()
      can('admin')
    `

    expect(renameUseAuthHasRole(source)).toBe(dedent`
      const { hasUserRole: can } = useAuth()
      can('admin')
    `)
  })

  it('renames useAuth().hasRole', () => {
    const source = "const isAdmin = useAuth().hasRole('admin')"

    expect(renameUseAuthHasRole(source)).toBe(
      "const isAdmin = useAuth().hasUserRole('admin')",
    )
  })

  it('renames hasRole on a variable holding useAuth()', () => {
    const source = dedent`
      const auth = useAuth()
      const isAdmin = auth.hasRole('admin')
      const other = somethingElse.hasRole('admin')
    `

    expect(renameUseAuthHasRole(source)).toBe(dedent`
      const auth = useAuth()
      const isAdmin = auth.hasUserRole('admin')
      const other = somethingElse.hasRole('admin')
    `)
  })

  it('leaves files without useAuth() alone', () => {
    const source = dedent`
      import { hasRole } from './roles'

      hasRole('admin')
    `

    expect(renameUseAuthHasRole(source)).toBe(source)
  })

  it("doesn't rename properties of something else", () => {
    const source = dedent`
      const { hasRole } = useAuth()
      hasRole('admin')
      permissions.hasRole('admin')
    `

    expect(renameUseAuthHasRole(source)).toBe(dedent`
      const { hasUserRole } = useAuth()
      hasUserRole('admin')
      permissions.hasRole('admin')
    `)
  })

  it('changes nothing when run again', () => {
    const once = renameUseAuthHasRole(dedent`
      const { hasRole } = useAuth()
      const auth = useAuth()
      hasRole('admin') && auth.hasRole('editor') && useAuth().hasRole('x')
    `)

    expect(once).not.toMatch(/hasRole/)
    expect(renameUseAuthHasRole(once)).toBe(once)
  })
})
