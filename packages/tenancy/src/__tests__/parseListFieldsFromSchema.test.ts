import { describe, expect, it } from 'vitest'

import { parseListFieldsFromSchema } from '../prismaExtension.js'

describe('parseListFieldsFromSchema', () => {
  it('does not mistake a brace inside a quoted attribute default for the end of the model body', () => {
    const schema = `
model Organization {
  id      String    @id @default(cuid())
  config  String    @default("{}")
  name    String
  projects Project[]
}

model Project {
  id String @id
}
`
    const fields = parseListFieldsFromSchema(schema)
    const organizationFields = fields.get('Organization')

    expect(organizationFields?.knownFields.has('projects')).toBe(true)
    expect(organizationFields?.listFields.has('projects')).toBe(true)
  })

  it('does not mistake a brace inside a single-quoted attribute default for the end of the model body', () => {
    const schema = `
model Organization {
  id      String    @id @default(cuid())
  config  String    @default('{}')
  projects Project[]
}

model Project {
  id String @id
}
`
    const fields = parseListFieldsFromSchema(schema)
    const organizationFields = fields.get('Organization')

    expect(organizationFields?.knownFields.has('projects')).toBe(true)
    expect(organizationFields?.listFields.has('projects')).toBe(true)
  })

  it('does not mistake a brace inside a `//` comment for the end of the model body', () => {
    const schema = `
model Organization {
  id   String @id @default(cuid())
  // A comment with a stray brace: {
  name String
  projects Project[]
}

model Project {
  id String @id
}
`
    const fields = parseListFieldsFromSchema(schema)
    const organizationFields = fields.get('Organization')

    expect(organizationFields?.knownFields.has('projects')).toBe(true)
    expect(organizationFields?.listFields.has('projects')).toBe(true)
  })

  it('handles a quoted brace, a comment brace, and a trailing-comment brace together, before a list relation', () => {
    const schema = `
model Organization {
  id      String    @id @default(cuid())
  config  String    @default("{}")
  // A comment with a stray brace: {
  slug    String    @unique // e.g. "acme", never "{acme}"
  projects Project[]
  owner    Owner?
}

model Project {
  id String @id
}

model Owner {
  id String @id
}
`
    const fields = parseListFieldsFromSchema(schema)
    const organizationFields = fields.get('Organization')

    expect(organizationFields?.knownFields.has('projects')).toBe(true)
    expect(organizationFields?.listFields.has('projects')).toBe(true)
    // `owner` is a to-one relation declared after the same braces; it must
    // still be read as a known, non-list field rather than dropped.
    expect(organizationFields?.knownFields.has('owner')).toBe(true)
    expect(organizationFields?.listFields.has('owner')).toBe(false)
  })

  it('still finds a later model after a model body containing braces in quotes and comments', () => {
    const schema = `
model Organization {
  id     String @id @default(cuid())
  config String @default("{}")
}

model Project {
  id   String    @id
  tags Tag[]
}

model Tag {
  id String @id
}
`
    const fields = parseListFieldsFromSchema(schema)

    expect(fields.has('Organization')).toBe(true)
    expect(fields.get('Project')?.listFields.has('tags')).toBe(true)
  })
})
