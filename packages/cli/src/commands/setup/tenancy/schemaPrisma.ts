/**
 * Plain-text editing of `api/db/schema.prisma` for `yarn cedar setup tenancy`.
 *
 * The setup command appends the framework-known `Organization` and
 * `Membership` models and adds a `memberships` relation to the app's
 * existing `User` model. This is done with text manipulation, not a schema
 * AST, because Prisma's schema parser (`@prisma/internals`) is read-only:
 * there is no supported way to print a modified schema back out while
 * preserving the user's formatting and comments.
 */

export const ORGANIZATION_MODEL = `model Organization {
  id          String       @id @default(cuid())
  name        String
  slug        String       @unique
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt
  memberships Membership[]
}`

export const MEMBERSHIP_MODEL = `model Membership {
  id              String       @id @default(cuid())
  role            String
  // Null while the membership is a pending invitation.
  userId          String?
  organizationId  String
  invitedById     String?
  invitationToken String?      @unique
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt
  user            User?        @relation(fields: [userId], references: [id])
  organization    Organization @relation(fields: [organizationId], references: [id])
  invitedBy       Membership?  @relation("Inviter", fields: [invitedById], references: [id])
  invitees        Membership[] @relation("Inviter")

  @@unique([userId, organizationId])
  @@index([organizationId])
}`

// Identical to `RW_DATA_MIGRATION_MODEL` in
// packages/cli-packages/dataMigrate/src/commands/installHandler.ts (kept as
// a literal copy here rather than an import, since `@cedarjs/cli` does not
// otherwise depend on `@cedarjs/cli-packages/dataMigrate`). `data-migrate up`
// fails at runtime with no clear error when this model is missing, so
// `setup tenancy` -- which is what usually creates a project's first data
// migration -- adds it when it isn't already there.
export const RW_DATA_MIGRATION_MODEL = `model RW_DataMigration {
  version    String   @id
  name       String
  startedAt  DateTime
  finishedAt DateTime
}`

/**
 * True when `schema` already declares `model <modelName> { ... }`, ignoring
 * how the model's body is formatted.
 */
export function hasModel(schema: string, modelName: string): boolean {
  return new RegExp(`\\bmodel\\s+${modelName}\\s*\\{`).test(schema)
}

interface ModelBlock {
  /** Index of the character right after the model's opening `{`. */
  bodyStart: number
  /** Index of the model's closing `}`. */
  bodyEnd: number
}

/**
 * Locates `model <modelName> { ... }` in `schema` by counting braces from
 * the opening one, so nested `{}` (none expected in a Prisma model, but
 * cheap to handle correctly) do not confuse the search.
 */
function findModelBlock(schema: string, modelName: string): ModelBlock | null {
  const headerMatch = new RegExp(`model\\s+${modelName}\\s*\\{`).exec(schema)

  if (!headerMatch) {
    return null
  }

  const bodyStart = headerMatch.index + headerMatch[0].length
  let depth = 1
  let index = bodyStart

  for (; index < schema.length; index++) {
    if (schema[index] === '{') {
      depth++
    } else if (schema[index] === '}') {
      depth--
      if (depth === 0) {
        break
      }
    }
  }

  if (depth !== 0) {
    return null
  }

  return { bodyStart, bodyEnd: index }
}

/**
 * Adds `memberships Membership[]` as the last field of `model User { ... }`.
 * Throws `RW_TENANCY_ERR_NO_USER_MODEL` when there is no `User` model, since
 * tenancy is layered on top of an app that already has auth set up.
 */
export function addMembershipsToUser(schema: string): string {
  const block = findModelBlock(schema, 'User')

  if (!block) {
    throw new Error('RW_TENANCY_ERR_NO_USER_MODEL')
  }

  const before = schema.slice(0, block.bodyEnd)
  const after = schema.slice(block.bodyEnd)
  const separator = before.endsWith('\n') ? '' : '\n'

  return `${before}${separator}  memberships Membership[]\n${after}`
}

/** Appends the `Organization` and `Membership` models to the end of `schema`. */
export function addTenancyModels(schema: string): string {
  return `${schema.trimEnd()}\n\n${ORGANIZATION_MODEL}\n\n${MEMBERSHIP_MODEL}\n`
}

/**
 * Appends `RW_DataMigration` to `schema` when it is not already declared.
 * Idempotent: returns `schema` unchanged when the model already exists
 * (whether `data-migrate install` added it, or a previous `setup tenancy`
 * run did).
 */
export function addDataMigrationModel(schema: string): string {
  if (hasModel(schema, 'RW_DataMigration')) {
    return schema
  }

  return `${schema.trimEnd()}\n\n${RW_DATA_MIGRATION_MODEL}\n`
}

export interface EditSchemaOptions {
  /** When true, an existing `Organization`/`Membership` model is left as-is instead of aborting. */
  force: boolean
}

/**
 * Applies every schema.prisma edit `setup tenancy` needs, in one pass.
 *
 * Throws `RW_TENANCY_ERR_NO_USER_MODEL` when there is no `User` model to add
 * `memberships` to (auth has not been set up yet), and
 * `RW_TENANCY_ERR_MODELS_EXIST` when `Organization` or `Membership` already
 * exist and `force` was not passed. With `force`, existing `Organization`/
 * `Membership` models are left untouched (there is no safe way to merge a
 * user's model with the framework's), and only the `User.memberships`
 * relation is added if it is missing. `RW_DataMigration` is added whenever
 * it is absent, regardless of `force` or whether Organization/Membership
 * were already present.
 */
export function editSchema(schema: string, options: EditSchemaOptions): string {
  if (!hasModel(schema, 'User')) {
    throw new Error('RW_TENANCY_ERR_NO_USER_MODEL')
  }

  const modelsExist =
    hasModel(schema, 'Organization') || hasModel(schema, 'Membership')

  if (modelsExist && !options.force) {
    throw new Error('RW_TENANCY_ERR_MODELS_EXIST')
  }

  const withTenancyModels = modelsExist
    ? schema
    : addMembershipsToUser(addTenancyModels(schema))

  // Independent of whether Organization/Membership were just added or
  // already existed: an app that never ran `data-migrate install` still
  // needs RW_DataMigration before `data-migrate up` (which the setup
  // output tells the user to run) can work.
  return addDataMigrationModel(withTenancyModels)
}
