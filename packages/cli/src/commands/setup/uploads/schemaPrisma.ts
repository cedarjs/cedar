/**
 * Plain-text editing of `api/db/schema.prisma` for `cedar setup uploads`. The
 * `Upload` model is framework-known, so it is appended verbatim.
 */

export const UPLOAD_MODEL = `model Upload {
  id             String   @id @default(cuid())
  /// Name of the storage target, as configured in api/src/lib/uploads
  target         String
  /// "pending" | "completed" | "failed"
  status         String   @default("pending")
  filename       String
  mimeType       String
  /// Bytes. BigInt because Int caps at 2 GB.
  size           BigInt
  /// Provider-specific reference: S3 object key, filename on disk, or null
  /// for files stored inline
  storageKey     String?
  /// Inline bytes, only for DB targets
  data           Bytes?
  /// The user the file belongs to, when it belongs to one
  userId         String?
  /// Id of the upload token that created this row
  tokenId        String?
  /// The organization the file belongs to, in multi-tenant apps
  organizationId String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}`

/**
 * True when `schema` already declares `model <modelName> { ... }`, ignoring
 * how the model's body is formatted.
 */
export function hasModel(schema: string, modelName: string): boolean {
  return new RegExp(`\\bmodel\\s+${modelName}\\s*\\{`).test(schema)
}

/**
 * Appends the `Upload` model. Returns the schema unchanged when a model of
 * that name already exists, so running the command twice is a no-op rather
 * than a duplicate; an existing model that differs from the framework's is
 * the app's to reconcile.
 */
export function addUploadModel(schema: string): string {
  if (hasModel(schema, 'Upload')) {
    return schema
  }

  return `${schema.trimEnd()}\n\n${UPLOAD_MODEL}\n`
}
