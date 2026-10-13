import { randomUUID } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'

import mime from 'mime-types'

import { UploadError } from './errors.js'
import { generateStorageKey } from './keys.js'
import { DB_MAX_FILE_SIZE } from './profiles.js'
import { toDataUri } from './serialize.js'
import { resolveTarget } from './targets.js'
import type {
  ContentDisposition,
  StorageProvider,
  StorageTargets,
  UploadVariantDatabase,
  UploadVariantRecord,
} from './types.js'

const ONE_DAY = 24 * 60 * 60 * 1000
const TEN_MINUTES = 10 * 60 * 1000

// `type/subtype`, the shape every stored MIME type must have
const MIME_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i

// Variant names end up in filenames and logs, so keep them plain
const VARIANT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** The file a variant generator returns. */
export interface UploadVariantFile {
  /** The derived file's bytes. */
  data: Uint8Array
  /** MIME type of `data`, for example `image/webp`. */
  mimeType: string
  /**
   * Filename for the derived file's `Upload` row. Defaults to the source's
   * filename without its extension, plus the variant name and the extension
   * of `mimeType`: `photo.jpg` becomes `photo-thumb-164.webp`.
   */
  filename?: string
}

/** What a variant generator is called with. */
export interface UploadVariantContext {
  /** The source file's `Upload` row, without its inline `data`. */
  source: UploadVariantRecord
  /** Name of the variant being made, for example `'thumb-164'`. */
  variant: string
  /** Reads the source file's bytes from whichever target holds them. */
  readSource(): Promise<Buffer>
  /**
   * Reads another variant of the same source, making it first if it does
   * not exist yet. Returns `null` when that variant could not be made. This
   * is how one derived file is made from another, for example a PDF's
   * thumbnail cut from its drawn first page (`readVariant('preview')`).
   */
  readVariant(name: string): Promise<Buffer | null>
}

/**
 * Makes one derived file (variant) from its source: a thumbnail from a
 * photo, a preview image from a PDF, a poster frame from a video. This is
 * the only part the app writes; the uploads package stores the result,
 * links it to its source, and keeps track of it.
 *
 * Return `null` when this source cannot have this variant (a file type the
 * generator does not handle). Both `null` and a thrown error are remembered
 * as a failure and not retried until `retryFailedAfter` has passed.
 */
export type UploadVariantGenerator = (
  context: UploadVariantContext,
) => Promise<UploadVariantFile | null> | UploadVariantFile | null

/** A variant generator plus where its files are stored. */
export interface UploadVariantDefinition {
  generate: UploadVariantGenerator
  /** Storage target for this variant's files. Defaults to the `target` option. */
  target?: StorageProvider
}

export interface DefineUploadVariantsOptions<Name extends string> {
  db: UploadVariantDatabase
  /**
   * Every configured storage target. Used to read sources and to read and
   * delete variants wherever they are stored.
   */
  targets: StorageTargets
  /** Storage target new variant files are written to, unless a variant names its own. */
  target: StorageProvider
  /**
   * The variants, by name, each with the function that makes it:
   * `{ 'thumb-164': makeThumb, preview: makePdfPreview }`. Names may use
   * letters, digits, `.`, `_` and `-`.
   */
  variants: Record<Name, UploadVariantGenerator | UploadVariantDefinition>
  /**
   * How long a variant that could not be made is left alone before the
   * next request tries again, in milliseconds. Defaults to one day.
   */
  retryFailedAfter?: number
  /**
   * How long a claim to make a variant is honored, in milliseconds. A
   * request that finds a claim older than this assumes its maker died and
   * makes the variant itself. Defaults to ten minutes; set it above the
   * slowest generator's running time.
   */
  claimTimeout?: number
  /**
   * How often a request waiting for another process to finish making the
   * same variant checks again, in milliseconds. Defaults to 250.
   */
  pollInterval?: number
  /**
   * Called when a generator throws or its result cannot be stored. Defaults
   * to `console.error`. The failure is remembered either way.
   */
  onError?: (
    error: unknown,
    info: { sourceId: string; variant: string },
  ) => void
}

/** What `regenerateVariants()` did. */
export interface RegenerateVariantsResult {
  /** Variant files deleted, made or failed alike. */
  deleted: number
  /** Variants made again. */
  made: number
  /** Variants that could not be made again (remembered as failed). */
  failed: number
  /** Variants that could not be deleted; reported through `onError`. */
  errors: number
}

/** A source upload, by id or by its row. */
export type UploadVariantSource = string | { id: string }

/**
 * Derived files (variants) of uploads: thumbnails, previews, poster frames.
 * Returned by `defineUploadVariants()`.
 */
export interface UploadVariants<Name extends string> {
  /** The configured variant names. */
  names: readonly Name[]
  /**
   * The variant's `Upload` row, made now if it does not exist yet. Returns
   * `null` when it could not be made and `retryFailedAfter` has not passed.
   *
   * Making a variant happens once: concurrent calls in this process share
   * one attempt, and across processes a claim row decides who makes it
   * while the others wait for the result.
   */
  getVariant(
    source: UploadVariantSource,
    name: Name,
  ): Promise<UploadVariantRecord | null>
  /**
   * The variant's `Upload` row if it has been made, or `null`. Never makes
   * anything; use it where making on demand would be too slow, such as a
   * list page.
   */
  findVariant(
    source: UploadVariantSource,
    name: Name,
  ): Promise<UploadVariantRecord | null>
  /**
   * The made variants of many sources in one query, keyed by source id.
   * Sources without that variant are left out. Never makes anything.
   */
  findVariants(
    sourceIds: string[],
    name: Name,
  ): Promise<Map<string, UploadVariantRecord>>
  /**
   * The variant's row and bytes, made now if it does not exist yet, or
   * `null` when it could not be made.
   */
  readVariant(
    source: UploadVariantSource,
    name: Name,
  ): Promise<{ upload: UploadVariantRecord; data: Buffer } | null>
  /**
   * A URL a browser can load the variant from, made now if it does not
   * exist yet: a signed URL for object storage, a `data:` URI for database
   * targets. `null` when the variant could not be made.
   */
  getVariantUrl(
    source: UploadVariantSource,
    name: Name,
    options?: { expiresIn?: number; disposition?: ContentDisposition },
  ): Promise<string | null>
  /**
   * Remakes every variant called `name`, for every source that has one
   * (made or failed), and leaves other variants alone. Use it after fixing
   * a generator. Each old file is deleted, then the variant is made again
   * unless `remake` is `false`, in which case it is made on its next read.
   */
  regenerateVariants(
    name: Name,
    options?: { remake?: boolean; batchSize?: number },
  ): Promise<RegenerateVariantsResult>
  /**
   * Deletes all variants of a source, bytes first, then rows. `deleteFile()`
   * does this for you when given `targets`.
   */
  deleteVariants(source: UploadVariantSource): Promise<number>
}

function idOf(source: UploadVariantSource): string {
  return typeof source === 'string' ? source : source.id
}

function isPrismaError(e: unknown, code: string): boolean {
  return typeof e === 'object' && e !== null && 'code' in e && e.code === code
}

function defaultFilename(
  sourceFilename: string,
  name: string,
  mimeType?: string,
) {
  const base = sourceFilename.replace(/\.[^./\\]*$/, '') || 'file'
  const ext = mimeType ? mime.extension(mimeType.split(';')[0].trim()) : false

  return ext ? `${base}-${name}.${ext}` : `${base}-${name}`
}

/**
 * Reads an upload's bytes from whichever target holds them: inline from the
 * row for database targets, from the provider for everything else.
 */
async function readBytes(
  db: UploadVariantDatabase,
  targets: StorageTargets,
  upload: UploadVariantRecord,
): Promise<Buffer> {
  const target = resolveTarget(targets, upload.target)

  if (target.providerType === 'db') {
    const row = await db.upload.findUnique({ where: { id: upload.id } })

    if (!row?.data) {
      throw new UploadError(
        'NOT_FOUND',
        `Upload '${upload.id}' has no inline data.`,
      )
    }

    return Buffer.from(row.data)
  }

  if (!upload.storageKey) {
    throw new UploadError(
      'NOT_FOUND',
      `Upload '${upload.id}' has no stored file.`,
    )
  }

  return Buffer.from(await target.read(upload.storageKey))
}

/**
 * Deletes one variant: its bytes, then its row. A missing object or row is
 * tolerated.
 *
 * The row is deleted only in the state its bytes were deleted for. A
 * generator that finishes in between saves its file to the row, so the row
 * is read again and that file deleted too.
 */
async function deleteVariantRow(
  db: UploadVariantDatabase,
  targets: StorageTargets,
  row: UploadVariantRecord,
) {
  let current: UploadVariantRecord | null = row

  while (current) {
    if (current.storageKey) {
      await resolveTarget(targets, current.target).delete(current.storageKey)
    }

    const { count } = await db.upload.deleteMany({
      where: {
        id: current.id,
        status: current.status,
        tokenId: current.tokenId,
        storageKey: current.storageKey,
      },
    })

    if (count === 1) {
      return
    }

    current = await db.upload.findUnique({
      where: { id: current.id },
      omit: { data: true },
    })
  }
}

/**
 * Deletes every derived file (variant) of `source`: bytes first, then rows,
 * like `deleteFile()`. Returns how many were deleted. `deleteFile()` calls
 * this when given `targets`, so a source never goes without its variants.
 */
export async function deleteVariants(
  source: UploadVariantSource,
  { db, targets }: { db: UploadVariantDatabase; targets: StorageTargets },
): Promise<number> {
  const rows = await db.upload.findMany({
    where: { sourceId: idOf(source) },
    omit: { data: true },
  })

  for (const row of rows) {
    await deleteVariantRow(db, targets, row)
  }

  return rows.length
}

/**
 * Declares the derived files (variants) uploads can have, such as
 * thumbnails, previews or a video's poster frame, each with the function
 * that makes it. **Experimental.**
 *
 * The app supplies only the generators. The uploads package keeps the
 * bookkeeping: each variant is an `Upload` row linked to its source by
 * `sourceId` and named by `variant`; it is made on first read, once even
 * when several requests or processes ask at the same moment; a variant
 * that cannot be made is remembered and tried again after
 * `retryFailedAfter`; `regenerateVariants()` remakes every variant of one
 * name; and `deleteFile()` with `targets` deletes a source's variants with
 * it.
 *
 * The package does not make images or read videos itself. A generator is
 * any function from source bytes to new bytes, using sharp, pdf.js, ffmpeg
 * or a third-party service as the app sees fit.
 *
 * @example
 * export const uploadVariants = defineUploadVariants({
 *   db,
 *   targets,
 *   target: targets.thumbnails,
 *   variants: {
 *     'thumb-164': async ({ readSource }) => ({
 *       data: await sharp(await readSource()).resize(164, 164).webp().toBuffer(),
 *       mimeType: 'image/webp',
 *     }),
 *   },
 * })
 *
 * const thumb = await uploadVariants.getVariant(photo.uploadId, 'thumb-164')
 */
export function defineUploadVariants<Name extends string>(
  options: DefineUploadVariantsOptions<Name>,
): UploadVariants<Name> {
  const {
    db,
    targets,
    target: defaultTarget,
    retryFailedAfter = ONE_DAY,
    claimTimeout = TEN_MINUTES,
    pollInterval = 250,
    onError = (error, { sourceId, variant }) =>
      console.error(
        `[cedar uploads] could not make variant '${variant}' of ${sourceId}:`,
        error,
      ),
  } = options

  const definitions = new Map<string, Required<UploadVariantDefinition>>()

  for (const [name, value] of Object.entries<
    UploadVariantGenerator | UploadVariantDefinition
  >(options.variants)) {
    if (!VARIANT_NAME.test(name)) {
      throw new UploadError(
        'CONFIGURATION',
        `Invalid variant name '${name}'. Use letters, digits, '.', '_' and ` +
          "'-', starting with a letter or digit.",
      )
    }

    const definition = typeof value === 'function' ? { generate: value } : value
    const target = definition.target ?? defaultTarget

    // Variant rows record their target by name, and reads and deletes look
    // it up in `targets`, so a target missing from there would leave files
    // that can't be read or deleted
    if (
      !Object.hasOwn(targets, target.name) ||
      targets[target.name] !== target
    ) {
      throw new UploadError(
        'CONFIGURATION',
        `Variant '${name}' uses a storage target that isn't in \`targets\`.`,
      )
    }

    definitions.set(name, { generate: definition.generate, target })
  }

  const names = [...definitions.keys()] as Name[]

  // One attempt per source and variant in this process; other callers
  // share its promise
  const inFlight = new Map<string, Promise<UploadVariantRecord | null>>()
  // The attempts each in-flight attempt is waiting for through
  // `readVariant()`, to refuse a dependency cycle between attempts that
  // started separately
  const waitingFor = new Map<string, string[]>()

  const keyOf = (sourceId: string, name: string) => `${sourceId}\0${name}`

  const isWaitingFor = (from: string, to: string): boolean => {
    const seen = new Set<string>()
    const stack = [from]

    for (let key = stack.pop(); key !== undefined; key = stack.pop()) {
      if (key === to) {
        return true
      }

      if (!seen.has(key)) {
        seen.add(key)
        stack.push(...(waitingFor.get(key) ?? []))
      }
    }

    return false
  }

  /** `obtain()` for a generator's `readVariant()`, recording the wait. */
  const obtainFor = async (
    waiter: string,
    sourceId: string,
    name: string,
    chain: string[],
  ) => {
    const key = keyOf(sourceId, name)

    // `obtain()` refuses a cycle within one chain of reads with the whole
    // chain in its message
    if (
      !chain.includes(name) &&
      inFlight.has(key) &&
      isWaitingFor(key, waiter)
    ) {
      throw new UploadError(
        'CONFIGURATION',
        `Variant '${name}' and the variant reading it depend on each other.`,
      )
    }

    const waits = waitingFor.get(waiter) ?? []
    waitingFor.set(waiter, [...waits, key])

    try {
      return await obtain(sourceId, name, chain)
    } finally {
      const rest = waitingFor.get(waiter) ?? []
      rest.splice(rest.indexOf(key), 1)

      if (rest.length === 0) {
        waitingFor.delete(waiter)
      }
    }
  }

  const definitionOf = (name: string) => {
    const definition = definitions.get(name)

    if (!definition) {
      throw new UploadError(
        'CONFIGURATION',
        `Unknown upload variant '${name}'. Configured variants: ` +
          `${names.join(', ') || '(none)'}.`,
      )
    }

    return definition
  }

  const loadSource = async (sourceId: string) => {
    const source = await db.upload.findUnique({
      where: { id: sourceId },
      omit: { data: true },
    })

    if (source?.status !== 'completed') {
      throw new UploadError(
        'NOT_FOUND',
        `Upload '${sourceId}' does not exist or is not completed, so it ` +
          'cannot have variants.',
      )
    }

    if (source.sourceId) {
      throw new UploadError(
        'NOT_SUPPORTED',
        `Upload '${sourceId}' is itself a variant. Variants are made from ` +
          'original uploads only; use `readVariant()` in a generator to ' +
          'make one variant from another.',
      )
    }

    return source
  }

  const findRow = (sourceId: string, name: string) =>
    db.upload.findFirst({
      where: { sourceId, variant: name },
      omit: { data: true },
    })

  /** Makes the variant under a claim this call holds. */
  const make = async (
    source: UploadVariantRecord,
    rowId: string,
    claim: string,
    name: string,
    chain: string[],
  ): Promise<UploadVariantRecord | null> => {
    const definition = definitionOf(name)
    const target = definition.target
    const ours = { id: rowId, status: 'pending', tokenId: claim }

    const fail = async (error?: unknown) => {
      if (error !== undefined) {
        onError(error, { sourceId: source.id, variant: name })
      }

      await db.upload.updateMany({ where: ours, data: { status: 'failed' } })

      return null
    }

    let file: UploadVariantFile | null

    try {
      file = await definition.generate({
        source,
        variant: name,
        readSource: () => readBytes(db, targets, source),
        readVariant: async (other) => {
          const made = await obtainFor(
            keyOf(source.id, name),
            source.id,
            other,
            [...chain, name],
          )
          return made ? readBytes(db, targets, made) : null
        },
      })
    } catch (e) {
      return fail(e)
    }

    if (!file) {
      return fail()
    }

    if (!MIME_TYPE.test(file.mimeType)) {
      return fail(
        new UploadError(
          'MIME_TYPE_NOT_ALLOWED',
          `Variant '${name}' returned '${file.mimeType}', which is not a ` +
            'valid MIME type.',
        ),
      )
    }

    const isDbTarget = target.providerType === 'db'

    if (isDbTarget && file.data.byteLength > DB_MAX_FILE_SIZE) {
      return fail(
        new UploadError(
          'FILE_TOO_LARGE',
          `Variant '${name}' is ${file.data.byteLength} bytes, which exceeds ` +
            `the ${DB_MAX_FILE_SIZE} byte limit for target '${target.name}'.`,
        ),
      )
    }

    const storageKey = isDbTarget ? null : generateStorageKey(file.mimeType)

    if (storageKey) {
      try {
        await target.write(storageKey, file.data, {
          contentType: file.mimeType,
        })
      } catch (e) {
        // Storage being down is not the source file's fault, so the claim
        // is released rather than remembered as a failure
        await target.delete(storageKey).catch(() => undefined)
        await db.upload.deleteMany({ where: ours })
        throw e
      }
    }

    const { count } = await db.upload
      .updateMany({
        where: ours,
        data: {
          status: 'completed',
          // A retry or a takeover writes to the variant's current target,
          // which is not necessarily the one the row was created for
          target: target.name,
          storageKey,
          size: BigInt(file.data.byteLength),
          mimeType: file.mimeType,
          filename:
            file.filename ??
            defaultFilename(source.filename, name, file.mimeType),
          // Copying gives Prisma the plain-ArrayBuffer-backed array its
          // `Bytes` input requires
          data: isDbTarget ? new Uint8Array(file.data) : null,
          tokenId: null,
        },
      })
      .catch(async (e: unknown) => {
        // No row references the file, so nothing could find it to delete
        // it later
        if (storageKey) {
          await target.delete(storageKey).catch(() => undefined)
        }

        // Releases the claim, so other callers don't wait for
        // `claimTimeout` on a variant nobody is making
        await db.upload.deleteMany({ where: ours }).catch(() => undefined)

        throw e
      })

    if (count !== 1) {
      // The claim was lost while generating: the source or the variant was
      // deleted, or another process took over a claim it thought abandoned.
      // Nothing references these bytes.
      if (storageKey) {
        await target.delete(storageKey).catch(() => undefined)
      }

      const current = await findRow(source.id, name)
      return current?.status === 'completed' ? current : null
    }

    return db.upload.findUnique({ where: { id: rowId }, omit: { data: true } })
  }

  /**
   * Finds the variant, or claims and makes it, or waits for whoever holds
   * the claim. The claim is the variant's own `Upload` row in `pending`
   * status, unique per source and variant name, with a random claim id in
   * `tokenId`.
   */
  const obtainUncached = async (
    sourceId: string,
    name: string,
    chain: string[],
  ): Promise<UploadVariantRecord | null> => {
    const definition = definitionOf(name)
    const source = await loadSource(sourceId)

    for (;;) {
      const row = await findRow(sourceId, name)
      const now = Date.now()
      const claim = randomUUID()

      if (!row) {
        let created: UploadVariantRecord

        try {
          created = await db.upload.create({
            data: {
              sourceId,
              variant: name,
              target: definition.target.name,
              status: 'pending',
              filename: defaultFilename(source.filename, name),
              mimeType: 'application/octet-stream',
              size: 0n,
              tokenId: claim,
              userId: source.userId,
              organizationId: source.organizationId,
            },
          })
        } catch (e) {
          // Someone else claimed it first: go round and find their row
          if (isPrismaError(e, 'P2002')) {
            continue
          }

          // The source was deleted in between
          if (isPrismaError(e, 'P2003')) {
            throw new UploadError(
              'NOT_FOUND',
              `Upload '${sourceId}' was deleted while its variant ` +
                `'${name}' was being made.`,
              e,
            )
          }

          throw e
        }

        return make(source, created.id, claim, name, chain)
      }

      if (row.status === 'completed') {
        return row
      }

      if (row.status === 'failed') {
        const cutoff = new Date(now - retryFailedAfter)

        if (row.updatedAt >= cutoff) {
          return null
        }

        const { count } = await db.upload.updateMany({
          where: { id: row.id, status: 'failed', updatedAt: { lt: cutoff } },
          data: { status: 'pending', tokenId: claim },
        })

        if (count === 1) {
          return make(source, row.id, claim, name, chain)
        }

        continue
      }

      // Pending: another process is making it. Take over a claim that has
      // gone stale, otherwise wait and look again.
      const cutoff = new Date(now - claimTimeout)

      if (row.updatedAt < cutoff) {
        const { count } = await db.upload.updateMany({
          where: {
            id: row.id,
            status: 'pending',
            tokenId: row.tokenId,
            updatedAt: { lt: cutoff },
          },
          data: { tokenId: claim },
        })

        if (count === 1) {
          return make(source, row.id, claim, name, chain)
        }

        continue
      }

      await sleep(pollInterval)
    }
  }

  const obtain = (
    sourceId: string,
    name: string,
    chain: string[],
  ): Promise<UploadVariantRecord | null> => {
    if (chain.includes(name)) {
      return Promise.reject(
        new UploadError(
          'CONFIGURATION',
          `Variant '${name}' depends on itself: ` +
            `${[...chain, name].join(' -> ')}.`,
        ),
      )
    }

    const key = keyOf(sourceId, name)
    const running = inFlight.get(key)

    if (running) {
      return running
    }

    const attempt = obtainUncached(sourceId, name, chain)
    const forget = () => {
      if (inFlight.get(key) === attempt) {
        inFlight.delete(key)
      }
    }

    inFlight.set(key, attempt)
    attempt.then(forget, forget)

    return attempt
  }

  const getVariant = (source: UploadVariantSource, name: Name) =>
    obtain(idOf(source), name, [])

  const findVariant = async (source: UploadVariantSource, name: Name) => {
    definitionOf(name)

    return db.upload.findFirst({
      where: { sourceId: idOf(source), variant: name, status: 'completed' },
      omit: { data: true },
    })
  }

  const findVariants = async (sourceIds: string[], name: Name) => {
    definitionOf(name)

    const rows = sourceIds.length
      ? await db.upload.findMany({
          where: {
            sourceId: { in: sourceIds },
            variant: name,
            status: 'completed',
          },
          omit: { data: true },
        })
      : []

    const bySource = new Map<string, UploadVariantRecord>()

    for (const row of rows) {
      if (row.sourceId) {
        bySource.set(row.sourceId, row)
      }
    }

    return bySource
  }

  const readVariant = async (source: UploadVariantSource, name: Name) => {
    const upload = await getVariant(source, name)

    if (!upload) {
      return null
    }

    return { upload, data: await readBytes(db, targets, upload) }
  }

  const getVariantUrl = async (
    source: UploadVariantSource,
    name: Name,
    urlOptions: { expiresIn?: number; disposition?: ContentDisposition } = {},
  ) => {
    const upload = await getVariant(source, name)

    if (!upload) {
      return null
    }

    const target = resolveTarget(targets, upload.target)

    if (target.providerType === 'db') {
      return toDataUri(upload.mimeType, await readBytes(db, targets, upload))
    }

    if (!upload.storageKey) {
      return null
    }

    return target.getSignedReadUrl(upload.storageKey, urlOptions)
  }

  const regenerateVariants = async (
    name: Name,
    {
      remake = true,
      batchSize = 100,
    }: { remake?: boolean; batchSize?: number } = {},
  ): Promise<RegenerateVariantsResult> => {
    definitionOf(name)

    const result: RegenerateVariantsResult = {
      deleted: 0,
      made: 0,
      failed: 0,
      errors: 0,
    }
    // The newest existing variant of this name marks where the run ends.
    // Reading it from the rows, rather than from this process's clock,
    // keeps the cutoff on the database's clock.
    const newest = await db.upload.findFirst({
      where: { variant: name },
      omit: { data: true },
      orderBy: { createdAt: 'desc' },
    })

    if (!newest) {
      return result
    }

    const cutoff = newest.createdAt
    // Rows not to pick up again: ones that could not be deleted, and ones
    // this run made within the cutoff's millisecond
    const exclude: string[] = []

    for (;;) {
      const rows = await db.upload.findMany({
        where: {
          variant: name,
          createdAt: { lte: cutoff },
          ...(exclude.length > 0 && { id: { notIn: exclude } }),
        },
        omit: { data: true },
        orderBy: { createdAt: 'asc' },
        take: batchSize,
      })

      if (rows.length === 0) {
        return result
      }

      for (const row of rows) {
        // `variant` is only ever set together with `sourceId`
        const sourceId = row.sourceId ?? ''

        try {
          await deleteVariantRow(db, targets, row)
          result.deleted += 1
        } catch (e) {
          result.errors += 1
          exclude.push(row.id)
          onError(e, { sourceId, variant: name })
          continue
        }

        if (remake) {
          // An attempt still running here for the deleted row finds the row
          // gone and makes nothing. Let it end, so the variant is made anew
          await inFlight.get(keyOf(sourceId, name))?.catch(() => null)

          const made = await getVariant(sourceId, name).catch((e: unknown) => {
            onError(e, { sourceId, variant: name })
            return null
          })

          if (made) {
            result.made += 1
          } else {
            result.failed += 1
          }

          const current = await findRow(sourceId, name)

          if (current && current.createdAt <= cutoff) {
            exclude.push(current.id)
          }
        }
      }
    }
  }

  return {
    names,
    getVariant,
    findVariant,
    findVariants,
    readVariant,
    getVariantUrl,
    regenerateVariants,
    deleteVariants: (source) => deleteVariants(source, { db, targets }),
  }
}
