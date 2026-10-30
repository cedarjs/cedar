import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { findRoles, permissionsIndexSource, rolesInSource } from '../roles.js'

describe('rolesInSource', () => {
  it('finds the roles of SDL role lists', () => {
    const sdl = `
      type Query {
        posts: [Post!]! @requireAuth(roles: ["admin", "editor"])
        post(id: Int!): Post @requireAuth(roles: "reader")
        users: [User!]! @requireAuth
      }
      type User {
        roles: [String]!
      }
    `

    expect(rolesInSource(sdl)).toEqual(['admin', 'editor', 'reader'])
  })

  it('finds requireAuth and hasRole roles', () => {
    const source = `
      requireAuth({ roles: ['admin'] })
      requireAuth({ roles: "moderator" })
      if (hasRole('editor') || hasRole(["author", 'reviewer'])) {}
    `

    expect(rolesInSource(source)).toEqual([
      'admin',
      'moderator',
      'editor',
      'author',
      'reviewer',
    ])
  })

  it('finds the roles of PrivateSet and Private', () => {
    const routes = `
      <PrivateSet unauthenticated="login" roles="admin">
      <PrivateSet unauthenticated="login" roles={['editor', "author"]}>
      <Private unauthenticated="login" roles={"owner"}>
    `

    expect(rolesInSource(routes)).toEqual([
      'admin',
      'editor',
      'author',
      'owner',
    ])
  })

  it('skips roles that are not string literals', () => {
    const source = `
      export const requireAuth = ({ roles }: { roles?: AllowedRoles } = {}) => {
        if (roles && !hasRole(roles)) {}
        if (typeof roles === 'string') {}
      }
      const roles = currentUser.roles
      <PrivateSet roles={adminRoles}>
    `

    expect(rolesInSource(source)).toEqual([])
  })
})

describe('findRoles', () => {
  it('finds the roles in app code, sorted, and skips tests and mocks', () => {
    const dir = fs.mkdtempSync(
      path.join(fs.realpathSync(os.tmpdir()), 'cedar-roles-'),
    )

    try {
      fs.mkdirSync(path.join(dir, 'graphql'))
      fs.writeFileSync(
        path.join(dir, 'graphql', 'posts.sdl.ts'),
        'posts: [Post!]! @requireAuth(roles: ["editor", "admin"])',
      )
      fs.writeFileSync(
        path.join(dir, 'Routes.tsx'),
        '<PrivateSet unauthenticated="login" roles="admin">',
      )
      fs.writeFileSync(
        path.join(dir, 'posts.test.ts'),
        "mockCurrentUser({ roles: ['tester'] })",
      )
      fs.writeFileSync(
        path.join(dir, 'posts.scenarios.ts'),
        "data: { roles: 'seeded' }",
      )

      expect(findRoles([dir, path.join(dir, 'missing')])).toEqual([
        'admin',
        'editor',
      ])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('permissionsIndexSource', () => {
  const template =
    '/**\n__ROLES_COMMENT__\n */\ndefine({\n__DEFINITIONS__\n})\n'

  it('gives each role an entry with no permissions', () => {
    expect(permissionsIndexSource(template, ['admin', 'super-user']))
      .toMatchInlineSnapshot(`
        "/**
         * These are the roles the app's role lists name, with no
         * permissions yet. Add the permissions each one needs, then guard
         * fields with them instead of \`roles\`.
         */
        define({
          permissions: [],
          roles: {
            admin: [],
            "super-user": [],
          },
        })
        "
      `)
  })

  it('writes an example map without roles', () => {
    expect(permissionsIndexSource(template, [])).toContain(
      "editor: ['posts.read', 'posts.edit'],",
    )
  })
})
