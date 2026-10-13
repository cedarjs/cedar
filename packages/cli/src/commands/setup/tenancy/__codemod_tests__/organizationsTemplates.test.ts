import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates')

const TEMPLATES = [
  'organizations.scenarios.ts.template',
  'organizations.test.ts.template',
]

// Both templates' `user` fixtures are documented as assuming a plain
// dbAuth-style `User` model. Anything beyond these fields isn't guaranteed
// to exist on a freshly scaffolded `yarn cedar setup auth dbAuth
// --createUserModel` schema, and will make `cedar type-check` /
// `cedar test api` fail for anyone who runs `setup tenancy` against one.
// See #3006.
const ALLOWED_USER_FIELDS = ['email', 'hashedPassword', 'salt']

const SCALAR_FIELD = /^\s*(\w+):\s*'[^']*',?\s*$/

// Groups consecutive `key: 'value',` lines together, the way they appear
// inside a `{ ... }` object literal, so each group represents the scalar
// fields of one object (e.g. one `user.create({ ... })` call).
function scalarFieldGroups(templateSource: string): string[][] {
  const groups: string[][] = []
  let current: string[] = []

  for (const line of templateSource.split('\n')) {
    const match = line.match(SCALAR_FIELD)
    if (match) {
      current.push(match[1])
      continue
    }
    if (current.length > 0) {
      groups.push(current)
      current = []
    }
  }
  if (current.length > 0) {
    groups.push(current)
  }

  return groups
}

describe.each(TEMPLATES)('%s', (templateName) => {
  const templateSource = fs.readFileSync(
    path.join(TEMPLATES_DIR, templateName),
    'utf-8',
  )

  it('only sets fields that exist on a plain dbAuth User model', () => {
    const userFieldGroups = scalarFieldGroups(templateSource).filter(
      (fields) => fields.includes('email'),
    )

    expect(userFieldGroups.length).toBeGreaterThan(0)
    for (const fields of userFieldGroups) {
      for (const field of fields) {
        expect(ALLOWED_USER_FIELDS).toContain(field)
      }
    }
  })

  it('does not set fullName', () => {
    expect(templateSource).not.toContain('fullName')
  })
})
