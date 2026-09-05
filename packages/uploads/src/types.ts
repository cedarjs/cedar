import type { Readable } from 'node:stream'

/** Lifecycle state of an `Upload` row. */
export type UploadStatus = 'pending' | 'completed' | 'failed'

/**
 * How a served file asks the browser to handle it. `attachment` downloads;
 * `inline` renders in place. Serving defaults to `attachment` because the
 * stored MIME type is client-asserted.
 */
export type ContentDisposition = 'attachment' | 'inline'

/**
 * One row of the `Upload` table the setup command adds to `schema.prisma`.
 * `data` is optional because most code paths deliberately leave the inline
 * bytes out of the query.
 */
export interface UploadRecord {
  id: string
  target: string
  status: string
  filename: string
  mimeType: string
  size: bigint
  storageKey: string | null
  data?: Uint8Array | null
  userId: string | null
  tokenId: string | null
  organizationId: string | null
  createdAt: Date
  updatedAt: Date
}

export interface UploadCreateData {
  target: string
  status: UploadStatus
  filename: string
  mimeType: string
  size: bigint
  storageKey?: string | null
  // Prisma's `Bytes` input requires a Uint8Array backed by a plain
  // ArrayBuffer (not a SharedArrayBuffer)
  data?: Uint8Array<ArrayBuffer> | null
  userId?: string | null
  tokenId?: string | null
  organizationId?: string | null
}

export interface UploadWhere {
  id?: string | { in: string[] }
  target?: string
  status?: string | { in: string[] }
  storageKey?: string | null | { not: null }
  tokenId?: string
  createdAt?: { lt?: Date; gte?: Date }
}

export interface UploadUpdateData {
  status?: UploadStatus
  size?: bigint
  storageKey?: string | null
}

/**
 * The subset of Prisma's generated `Upload` delegate this package calls. The
 * generated client satisfies it structurally, so apps pass their `db` as-is.
 */
export interface UploadDelegate {
  create(args: { data: UploadCreateData }): Promise<UploadRecord>
  findUnique(args: { where: { id: string } }): Promise<UploadRecord | null>
  findUniqueOrThrow(args: { where: { id: string } }): Promise<UploadRecord>
  findFirst(args: {
    where: UploadWhere
    omit?: { data?: boolean }
  }): Promise<UploadRecord | null>
  findMany(args: {
    where: UploadWhere
    omit?: { data?: boolean }
    orderBy?: { createdAt: 'asc' | 'desc' }
    take?: number
  }): Promise<UploadRecord[]>
  updateMany(args: {
    where: UploadWhere
    data: UploadUpdateData
  }): Promise<{ count: number }>
  delete(args: { where: { id: string } }): Promise<UploadRecord>
  count(args: { where: UploadWhere }): Promise<number>
}

/** What a Prisma interactive transaction hands to its callback. */
export interface UploadTransactionClient {
  upload: UploadDelegate
}

/**
 * The subset of a Prisma client this package needs: the `Upload` delegate and
 * interactive transactions. Any generated client whose schema contains the
 * `Upload` model satisfies it.
 */
export interface UploadDatabase extends UploadTransactionClient {
  $transaction<T>(
    fn: (tx: UploadTransactionClient) => Promise<T>,
    options?: { isolationLevel?: 'Serializable' },
  ): Promise<T>
}

/**
 * The shape Uppy's S3 plugin (and any other direct-upload client) needs to
 * PUT a file straight into object storage.
 */
export interface PresignedUploadUrl {
  url: string
  method: string
  headers: Record<string, string>
}

/**
 * The contract every storage provider implements with its native SDK. It is
 * the minimum the framework needs to write, read, serve, and delete files;
 * provider-specific features stay on the provider's own client.
 */
export interface StorageProvider {
  /** Name of this provider instance, assigned by `defineStorageTargets()`. */
  name: string

  /**
   * `'db'` marks the provider that stores bytes inline in the `Upload` row.
   * Every other value (`'fs'`, `'s3'`, or a third-party string) is treated
   * identically as object storage.
   */
  providerType: 'db' | (string & {})

  /** Write bytes under `key`. */
  write(
    key: string,
    data: Uint8Array,
    opts: { contentType: string },
  ): Promise<void>

  /** Read the whole object into memory. */
  read(key: string): Promise<Buffer>

  /**
   * Stream the object. Optional; the serve route falls back to `read()` when
   * a provider does not implement it.
   */
  readStream?(key: string): Promise<Readable>

  /** Delete the object. A missing object is not an error. */
  delete(key: string): Promise<void>

  /** Whether the object exists. */
  exists(key: string): Promise<boolean>

  /**
   * Size of the object in bytes, or `null` when the provider cannot know.
   * Completion-time verification treats `null` as a failed check.
   */
  getObjectSize(key: string): Promise<number | null>

  /**
   * A time-limited URL for reading the object. Defaults to attachment
   * disposition wherever the provider controls response headers.
   */
  getSignedReadUrl(
    key: string,
    opts?: { expiresIn?: number; disposition?: ContentDisposition },
  ): Promise<string>

  /**
   * A presigned URL for direct client upload. Providers that cannot do this
   * (FS, DB) throw an `UploadError` with code `PRESIGN_NOT_SUPPORTED`.
   */
  getPresignedUploadUrl(
    key: string,
    opts: { contentType: string; size?: bigint; expiresIn?: number },
  ): Promise<PresignedUploadUrl>

  /**
   * Provider-specific configuration for third-party integrations. S3 returns
   * `{ bucket, region, keyPrefix }`, FS returns `{ uploadDir }`, DB `{}`.
   */
  getConfig(): Record<string, unknown>
}

export type StorageTargets = Record<string, StorageProvider>

/** A serialized `Upload` row, safe to return from a route or resolver. */
export interface SerializedUpload {
  id: string
  target: string
  status: string
  filename: string
  mimeType: string
  size: string
  storageKey: string | null
  userId: string | null
  organizationId: string | null
  createdAt: string
  updatedAt: string
}
