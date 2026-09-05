/**
 * Plain-text editing of `api/db/schema.prisma` for `yarn cedar setup tenancy`.
 *
 * The setup command appends the framework-known `Organization` and
 * `Membership` models. The `memberships` back-relation on the app's existing
 * `User` model is added by `prisma format`, not by this module: appending
 * models that declare a relation to `User` is enough for Prisma's formatter
 * to add the matching field. This avoids a hand-rolled schema parser, which
 * can't preserve the user's formatting and comments the way the formatter
 * does.
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
  updatedAt   DateTime     @updatedAt
  user            User?        @relation(fields: [userId], references: [id])
  organization    Organization @relation(fields: [organizationId], references: [id])
  invitedBy       Membership?  @relation("Inviter", fields: [invitedById], references: [id])
  invitees        Membership[] @relation("Inviter")

  @@unique([userId, organizationId])
  @@index([organizationId])
}`

// Identical to `RW_DATA_MIGRATION_MODEL` in
// packages/cli-packages/dataMigrate/src/commands/installHandler.ts (kept as a
// literal copy here rather than an import, since `@cedarjs/cli` does not
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

/** Appends the `Organization` and `Membership` models to the end of `schema`. */
export function addTenancyModels(schema: string): string {
  return [ORGANIZATION_MODEL, MEMBERSHIP_MODEL].reduce(appendModel, schema)
}

/**
 * Appends `model`, unless the schema already contains it exactly as written
 * here, which makes running the command twice a no-op rather than a
 * duplicate. A model of the same name that differs is left alone and this one
 * appended beside it, so Prisma reports the clash rather than this command
 * guessing which one the app wanted.
 */
function appendModel(schema: string, model: string): string {
  if (schema.includes(model)) {
    return schema
  }

  return `${schema.trimEnd()}\n\n${model}\n`
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
 * The `memberships` relation on `User` is not added here: `prisma format`
 * adds it once `Organization` and `Membership` declare relations to `User`.
 * The handler runs formatting after this and stops with instructions if the
 * field is missing, since the generated `getCurrentUser` selects it.
 *
 * Throws `CEDAR_TENANCY_ERR_NO_USER_MODEL` when there is no `User` model (auth
 * has not been set up yet), and `CEDAR_TENANCY_ERR_MODELS_EXIST` when
 * `Organization` or `Membership` already exist and `force` was not passed.
 * With `force`, existing `Organization`/`Membership` models are left
 * untouched. `RW_DataMigration` is added whenever it is absent, regardless of
 * `force` or whether Organization/Membership were already present.
 */
export function editSchema(schema: string, options: EditSchemaOptions): string {
  if (!hasModel(schema, 'User')) {
    throw new Error('CEDAR_TENANCY_ERR_NO_USER_MODEL')
  }

  const modelsExist =
    hasModel(schema, 'Organization') || hasModel(schema, 'Membership')

  // Models this command wrote itself are not a clash: appending skips them,
  // so running it twice changes nothing. A model of the same name that
  // differs is the app's own, which is what `--force` is for.
  const modelsAreThisCommands =
    schema.includes(ORGANIZATION_MODEL) && schema.includes(MEMBERSHIP_MODEL)

  if (modelsExist && !modelsAreThisCommands && !options.force) {
    throw new Error('CEDAR_TENANCY_ERR_MODELS_EXIST')
  }

  const withTenancyModels = addTenancyModels(schema)

  // Independent of whether Organization/Membership were just added or
  // already existed: an app that never ran `data-migrate install` still
  // needs RW_DataMigration before `data-migrate up` (which the setup
  // output tells the user to run) can work.
  return addDataMigrationModel(withTenancyModels)
}
