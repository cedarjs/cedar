import { describe, it, expect } from 'vitest'

import {
  addDataMigrationModel,
  addMembershipsToUser,
  addTenancyModels,
  editSchema,
  hasModel,
} from '../schemaPrisma.js'

const BASE_SCHEMA = `datasource db {
  provider = "sqlite"
}

generator client {
  provider = "prisma-client"
}

model User {
  id    String @id @default(uuid())
  email String @unique
}

model Contact {
  id   Int    @id @default(autoincrement())
  name String
}
`

describe('hasModel', () => {
  it('finds a model regardless of surrounding whitespace', () => {
    expect(hasModel(BASE_SCHEMA, 'User')).toBe(true)
    expect(hasModel(BASE_SCHEMA, 'Contact')).toBe(true)
  })

  it('returns false when the model is not declared', () => {
    expect(hasModel(BASE_SCHEMA, 'Organization')).toBe(false)
  })
})

describe('addMembershipsToUser', () => {
  it('throws RW_TENANCY_ERR_NO_USER_MODEL when there is no User model', () => {
    const schemaWithoutUser = `model Contact {\n  id Int @id\n}\n`

    expect(() => addMembershipsToUser(schemaWithoutUser)).toThrow(
      'RW_TENANCY_ERR_NO_USER_MODEL',
    )
  })

  it('adds the memberships relation as the last field of User', () => {
    const result = addMembershipsToUser(BASE_SCHEMA)

    expect(result).toContain(
      'model User {\n  id    String @id @default(uuid())\n  email String @unique\n  memberships Membership[]\n}',
    )
    // Every other model is untouched.
    expect(result).toContain(
      'model Contact {\n  id   Int    @id @default(autoincrement())\n  name String\n}',
    )
  })
})

describe('addTenancyModels', () => {
  it('appends Organization and Membership after the existing models', () => {
    const result = addTenancyModels(BASE_SCHEMA)

    expect(result).toContain('model Organization {')
    expect(result).toContain('model Membership {')
    // Appended after, not before, the app's own models.
    expect(result.indexOf('model Contact {')).toBeLessThan(
      result.indexOf('model Organization {'),
    )
  })
})

describe('editSchema', () => {
  it('throws RW_TENANCY_ERR_NO_USER_MODEL when there is no User model', () => {
    const schemaWithoutUser = `model Contact {\n  id Int @id\n}\n`

    expect(() => editSchema(schemaWithoutUser, { force: false })).toThrow(
      'RW_TENANCY_ERR_NO_USER_MODEL',
    )
  })

  it('throws RW_TENANCY_ERR_MODELS_EXIST when Organization already exists and force is false', () => {
    const schemaWithOrg = `${BASE_SCHEMA}\nmodel Organization {\n  id String @id\n}\n`

    expect(() => editSchema(schemaWithOrg, { force: false })).toThrow(
      'RW_TENANCY_ERR_MODELS_EXIST',
    )
  })

  it('leaves an existing Organization model untouched when force is true', () => {
    const schemaWithOrg = `${BASE_SCHEMA}\nmodel Organization {\n  id String @id\n}\n`

    const result = editSchema(schemaWithOrg, { force: true })

    expect(result).toContain('model Organization {\n  id String @id\n}')
  })

  it('adds both models and the User relation on the happy path', () => {
    const result = editSchema(BASE_SCHEMA, { force: false })

    expect(result).toContain('memberships Membership[]')
    expect(result).toContain('model Organization {')
    expect(result).toContain('model Membership {')
  })

  it('adds RW_DataMigration even when force is true and Organization already exists', () => {
    const schemaWithOrg = `${BASE_SCHEMA}\nmodel Organization {\n  id String @id\n}\n`

    const result = editSchema(schemaWithOrg, { force: true })

    expect(result).toContain('model RW_DataMigration {')
  })

  it('adds RW_DataMigration on the happy path too', () => {
    const result = editSchema(BASE_SCHEMA, { force: false })

    expect(result).toContain('model RW_DataMigration {')
  })
})

describe('addDataMigrationModel', () => {
  it('appends RW_DataMigration when it is absent', () => {
    const result = addDataMigrationModel(BASE_SCHEMA)

    expect(result).toContain(
      'model RW_DataMigration {\n  version    String   @id\n  name       String\n  startedAt  DateTime\n  finishedAt DateTime\n}',
    )
  })

  it('is idempotent when RW_DataMigration already exists', () => {
    const schemaWithDataMigration = `${BASE_SCHEMA}\nmodel RW_DataMigration {\n  version    String   @id\n  name       String\n  startedAt  DateTime\n  finishedAt DateTime\n}\n`

    const result = addDataMigrationModel(schemaWithDataMigration)

    expect(result).toBe(schemaWithDataMigration)
    // Only one declaration, not a second one appended.
    expect(result.split('model RW_DataMigration {').length - 1).toBe(1)
  })
})
