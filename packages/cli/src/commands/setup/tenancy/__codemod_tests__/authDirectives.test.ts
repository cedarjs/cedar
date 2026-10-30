import fs from 'node:fs'
import path from 'node:path'

import dedent from 'ts-dedent'
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_REQUIRE_AUTH_DIRECTIVES,
  isDefaultRequireAuthDirective,
  renameRequireAuthDirective,
  renameLibAuthImports,
} from '../authDirectives.js'

const TEMPLATES = path.join(
  import.meta.dirname,
  '../../../../../../create-cedar-app/templates',
)

const read = (lang: 'ts' | 'js') =>
  fs.readFileSync(
    path.join(
      TEMPLATES,
      lang,
      `api/src/directives/requireAuth/requireAuth.${lang}`,
    ),
    'utf-8',
  )

describe('renameRequireAuthDirective', () => {
  it('renames every @requireAuth, with or without roles', () => {
    const sdl = dedent`
      type Query {
        posts: [Post!]! @requireAuth
        post(id: Int!): Post @requireAuth(roles: ["admin"])
        public: [Post!]! @skipAuth
      }
    `

    expect(renameRequireAuthDirective(sdl)).toBe(dedent`
      type Query {
        posts: [Post!]! @requireUserAuth
        post(id: Int!): Post @requireUserAuth(roles: ["admin"])
        public: [Post!]! @skipAuth
      }
    `)
  })

  it('leaves other directives that start with requireAuth alone', () => {
    const sdl = 'posts: [Post!]! @requireAuthor @requireUserAuth'

    expect(renameRequireAuthDirective(sdl)).toBe(sdl)
  })

  it('changes nothing when run again', () => {
    const once = renameRequireAuthDirective('posts: [Post!]! @requireAuth')

    expect(renameRequireAuthDirective(once)).toBe(once)
  })
})

describe('renameLibAuthImports', () => {
  it('renames the import and its uses', () => {
    const source = dedent`
      import { hasRole, requireAuth } from 'src/lib/auth'

      export const posts = () => {
        requireAuth({ roles: ['admin'] })
        return hasRole('editor') ? db.post.findMany() : []
      }
    `

    expect(renameLibAuthImports(source)).toBe(dedent`
      import { hasRole, requireUserAuth } from 'src/lib/auth'

      export const posts = () => {
        requireUserAuth({ roles: ['admin'] })
        return hasRole('editor') ? db.post.findMany() : []
      }
    `)
  })

  it('renames only the imported name when it has an alias', () => {
    const source = dedent`
      import { requireAuth as applicationRequireAuth } from '../../lib/auth.js'

      applicationRequireAuth({ roles })
    `

    expect(renameLibAuthImports(source)).toBe(dedent`
      import { requireUserAuth as applicationRequireAuth } from '../../lib/auth.js'

      applicationRequireAuth({ roles })
    `)
  })

  it('leaves a requireAuth from somewhere else alone', () => {
    const source = dedent`
      import { requireAuth } from '@cedarjs/graphql-server'

      requireAuth()
    `

    expect(renameLibAuthImports(source)).toBe(source)
  })

  it("doesn't rename properties or the directive", () => {
    const source = dedent`
      import { requireAuth } from 'src/lib/auth'

      requireAuth()
      auth.requireAuth()
      const sdl = 'field: String @requireAuth'
    `

    expect(renameLibAuthImports(source)).toBe(dedent`
      import { requireUserAuth } from 'src/lib/auth'

      requireUserAuth()
      auth.requireAuth()
      const sdl = 'field: String @requireAuth'
    `)
  })
})

describe('isDefaultRequireAuthDirective', () => {
  it.each(['ts', 'js'] as const)(
    'recognizes the generated %s directive',
    (lang) => {
      expect(isDefaultRequireAuthDirective(read(lang))).toBe(true)
    },
  )

  it.each(['ts', 'js'] as const)(
    'matches the generated %s template exactly',
    (lang) => {
      expect(DEFAULT_REQUIRE_AUTH_DIRECTIVES).toContain(read(lang))
    },
  )

  it('recognizes it however it has been formatted', () => {
    const reformatted = read('ts')
      .replaceAll("'", '"')
      .replace(
        'applicationRequireAuth({ roles })',
        'applicationRequireAuth({ roles, });',
      )
      .replace('// ', '// a comment ')

    expect(isDefaultRequireAuthDirective(reformatted)).toBe(true)
  })

  it("doesn't recognize a wrapped export", () => {
    const wrapped = read('ts').replace(
      'const requireAuth = createValidatorDirective(schema, validate)',
      'const requireAuth = withAudit(createValidatorDirective(schema, validate))',
    )

    expect(isDefaultRequireAuthDirective(wrapped)).toBe(false)
  })

  it("doesn't recognize a changed one", () => {
    const changed = read('ts').replace(
      'applicationRequireAuth({ roles })',
      'applicationRequireAuth({ roles })\n  audit(roles)',
    )

    expect(isDefaultRequireAuthDirective(changed)).toBe(false)
  })
})
