import { randomUUID } from 'node:crypto'

import mime from 'mime-types'

import { deleteFile } from './deleteFile.js'
import { UploadError } from './errors.js'
import { storeFile } from './storeFile.js'
import { resolveTarget } from './targets.js'
import type {
  DerivedFileDatabase,
  DerivedFileRecord,
  StorageProvider,
  StorageTargets,
  UploadDatabase,
  UploadRecord,
} from './types.js'

const MINUTE = 60 * 1000

// Variant names end up in filenames and logs, so keep them plain. Source
// names start every source key (`upload:<id>`), so they have no `.` or `:`
const VARIANT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const SOURCE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

/** A source file, as a source's `read()` returns it. */
export interface DerivedFileSourceFile {
  data: Uint8Array
  mimeType?: string
  /** Made files are named after it: `photo.jpg` gives `photo-thumb-164.webp`. */
  filename?: string
  /** Copied to the made files' `Upload` rows. */
  userId?: string | null
  organizationId?: string | null
}

/**
 * Where derived files are made from: uploads (`uploadSource()`), or files
 * stored elsewhere, such as documents fetched from a third-party API.
 */
export interface DerivedFileSource<Ref = string> {
  /** A stable string for a reference. Not needed for string references. */
  key?: (ref: Ref) => string
  /**
   * Reads the whole source file. `null` means it does not exist (a
   * permanent failure); a thrown error is temporary and retried. A streaming
   * variant can be added next to this later without changing it.
   */
  read: (
    ref: Ref,
  ) => Promise<DerivedFileSourceFile | null> | DerivedFileSourceFile | null
}

/** The file a generator makes. */
export interface DerivedFileOutput {
  data: Uint8Array
  mimeType: string
  filename?: string
}

/**
 * What a generator is called with. It is an object so that other ways to
 * read the source, such as `openSource()` (a stream) or `sourcePath()` (a
 * temp file), can be added later without breaking any generator.
 */
export interface DerivedFileContext {
  /** Its name in `sources`, its key (`upload:<id>`) and the app's reference. */
  source: { name: string; key: string; ref: unknown }
  variant: string
  /** Reads the source file, once per attempt however often it is called. */
  readSource(): Promise<DerivedFileSourceFile & { data: Buffer }>
}

/**
 * Makes one derived file: a thumbnail, a PDF's drawn first page, a video's
 * poster frame. Return `null` when this source can't have this variant; that
 * is a permanent failure. A thrown error is temporary, and retried.
 */
export type DerivedFileGenerator = (
  context: DerivedFileContext,
) => Promise<DerivedFileOutput | null> | DerivedFileOutput | null

export interface DerivedFileDefinition {
  generate: DerivedFileGenerator
  /** Where this variant's files are stored. Defaults to the `target` option. */
  target?: StorageProvider
}

type RefOf<S> = S extends { read: (ref: infer R) => unknown } ? R : never

/** One source file, by source name: `{ upload: id }`, `{ osdoc: ref }`. */
export type DerivedFileSourceRef<Sources> = {
  [K in keyof Sources & string]: { [P in K]: RefOf<Sources[K]> }
}[keyof Sources & string]

/**
 * `pending` means not ready yet: another process is making it, or a failed
 * attempt is waiting for its retry.
 */
export type DerivedFileResult =
  | { status: 'completed'; upload: UploadRecord }
  | { status: 'pending' }
  | { status: 'failed' }

export interface DefineDerivedFilesOptions<Sources, Name extends string> {
  db: DerivedFileDatabase
  /** Every storage target, to read and delete made files wherever they are. */
  targets: StorageTargets
  /** Where made files are stored, unless a variant names its own target. */
  target: StorageProvider
  /** By name: `{ upload: uploadSource({ db, targets }), osdoc: { read } }`. */
  sources: Sources
  /** By name: `{ 'thumb-164': makeThumb, preview: { generate, target } }`. */
  variants: Record<Name, DerivedFileGenerator | DerivedFileDefinition>
  /** Attempts before a throwing generator or source is failed. Default 3. */
  maxAttempts?: number
  /** Wait before the second attempt, doubling after it. Default one minute. */
  retryDelay?: number
  /**
   * After this long, an attempt is assumed to have died and the next acquire
   * starts a new one. Default ten minutes; keep it above the slowest
   * generator's running time.
   */
  claimTimeout?: number
  /** Called with what a generator or source throws. Default `console.error`. */
  onError?: (error: unknown, info: { source: string; variant: string }) => void
}

/** Derived files of uploads and of other sources. Experimental. */
export interface DerivedFiles<Sources, Name extends string> {
  names: readonly Name[]
  /** Where the variant stands, starting to make it if nobody has. */
  acquireVariant(
    source: DerivedFileSourceRef<Sources>,
    name: Name,
  ): Promise<DerivedFileResult>
  /** The variant's row and bytes, made now if needed; `null` if not ready or failed. */
  acquireVariantData(
    source: DerivedFileSourceRef<Sources>,
    name: Name,
  ): Promise<{ upload: UploadRecord; data: Buffer } | null>
  /** The variant's `Upload` row if it has been made. Never makes anything. */
  findVariant(
    source: DerivedFileSourceRef<Sources>,
    name: Name,
  ): Promise<UploadRecord | null>
  /** `findVariant()` for many sources in two queries, in the order given. */
  findVariants(
    sources: DerivedFileSourceRef<Sources>[],
    name: Name,
  ): Promise<(UploadRecord | null)[]>
  /**
   * Deletes every file of one variant, made or failed, so each is made again
   * on its next acquire. Use it after fixing a generator.
   */
  resetVariants(name: Name): Promise<{ deleted: number; errors: number }>
  /** Deletes a source file's derived files. Returns how many. */
  deleteFor(source: DerivedFileSourceRef<Sources>): Promise<number>
  /** `deleteFor()` through `uploadSource()`; what `deleteFile()` calls. */
  deleteForUpload(upload: string | { id: string }): Promise<number>
}

// Sources made by `uploadSource()`, for `deleteForUpload()` to find
const uploadSources = new WeakSet<object>()

// A source's `read()` returned `null`
class SourceGone extends Error {}

const PENDING = { status: 'pending' } as const
const FAILED = { status: 'failed' } as const

/** An upload's bytes, inline from the row or from its target. */
async function readBytes(
  db: UploadDatabase,
  targets: StorageTargets,
  upload: UploadRecord,
): Promise<Buffer> {
  const target = resolveTarget(targets, upload.target)
  const data =
    target.providerType === 'db'
      ? (upload.data ??
        (await db.upload.findUnique({ where: { id: upload.id } }))?.data)
      : upload.storageKey && (await target.read(upload.storageKey))

  if (!data) {
    throw new UploadError('NOT_FOUND', `Upload '${upload.id}' has no bytes.`)
  }

  return Buffer.from(data)
}

/**
 * Uploads as a source of derived files: `{ upload: id }`. Made files get
 * the upload's owner and organization. Pass `derivedFiles` to `deleteFile()`
 * to delete an upload's derived files with it.
 */
export function uploadSource({
  db,
  targets,
}: {
  db: UploadDatabase
  targets: StorageTargets
}): DerivedFileSource<string | { id: string }> {
  const source: DerivedFileSource<string | { id: string }> = {
    key: (ref) => (typeof ref === 'string' ? ref : ref.id),
    read: async (ref) => {
      const id = typeof ref === 'string' ? ref : ref.id
      const upload = await db.upload.findUnique({ where: { id } })

      if (upload && upload.status !== 'completed') {
        // Still arriving, so worth another attempt
        throw new UploadError('NOT_FOUND', `Upload '${id}' is not completed.`)
      }

      return upload && { ...upload, data: await readBytes(db, targets, upload) }
    },
  }

  uploadSources.add(source)

  return source
}

/**
 * Declares derived files (thumbnails, previews, poster frames), the
 * functions that make them, and the sources they are made from: uploads, or
 * files that live elsewhere. **Experimental.**
 *
 * Each made file is an ordinary `Upload` row; its bookkeeping is a row in
 * the `DerivedFile` table. A file is made on first acquire, by one process
 * at a time. A thrown error is retried `maxAttempts` times with backoff; a
 * `null` is remembered as failed until `resetVariants()`.
 *
 * @example
 * export const derivedFiles = defineDerivedFiles({
 *   db,
 *   targets,
 *   target: targets.thumbnails,
 *   sources: {
 *     upload: uploadSource({ db, targets }),
 *     osdoc: { read: (ref: string) => fetchDocument(ref) },
 *   },
 *   variants: { 'thumb-164': makeThumb },
 * })
 *
 * await derivedFiles.acquireVariant({ upload: uploadId }, 'thumb-164')
 */
export function defineDerivedFiles<
  Sources extends Record<string, DerivedFileSource<never>>,
  Name extends string,
>(
  options: DefineDerivedFilesOptions<Sources, Name>,
): DerivedFiles<Sources, Name> {
  const {
    db,
    targets,
    sources,
    maxAttempts = 3,
    retryDelay = MINUTE,
    claimTimeout = 10 * MINUTE,
    onError = (error, { source, variant }) =>
      console.error(
        `[cedar uploads] could not make '${variant}' of ${source}:`,
        error,
      ),
  } = options
  const sourceNames = Object.keys(sources)
  const definitions = new Map<string, Required<DerivedFileDefinition>>()

  for (const name of sourceNames) {
    if (!SOURCE_NAME.test(name) || typeof sources[name]?.read !== 'function') {
      throw new UploadError(
        'CONFIGURATION',
        `Invalid derived-file source '${name}'. A source has a read() ` +
          "function and a name of letters, digits, '_' and '-'.",
      )
    }
  }

  for (const [name, value] of Object.entries<
    DerivedFileGenerator | DerivedFileDefinition
  >(options.variants)) {
    const definition = typeof value === 'function' ? { generate: value } : value
    const target = definition.target ?? options.target

    if (!VARIANT_NAME.test(name)) {
      throw new UploadError(
        'CONFIGURATION',
        `Invalid variant name '${name}'. Use letters, digits, '.', '_' and ` +
          "'-', starting with a letter or digit.",
      )
    }

    // Made files are read and deleted through `targets`, by target name
    if (targets[target.name] !== target) {
      throw new UploadError(
        'CONFIGURATION',
        `Variant '${name}' uses a storage target that isn't in \`targets\`.`,
      )
    }

    definitions.set(name, { generate: definition.generate, target })
  }

  const names = [...definitions.keys()] as Name[]
  // One attempt per source file and variant in this process, shared
  const inFlight = new Map<string, Promise<DerivedFileResult>>()

  const definitionOf = (name: string) => {
    const definition = definitions.get(name)

    if (!definition) {
      throw new UploadError(
        'CONFIGURATION',
        `Unknown variant '${name}'. Configured variants: ` +
          `${names.join(', ') || '(none)'}.`,
      )
    }

    return definition
  }

  const sourceOf = (ref: object) => {
    const entries = Object.entries(ref)
    const [name, value]: [string?, unknown?] = entries[0] ?? []

    if (entries.length !== 1 || !name || !Object.hasOwn(sources, name)) {
      throw new UploadError(
        'CONFIGURATION',
        'Name exactly one configured source, such as `{ upload: id }`. ' +
          `Configured sources: ${sourceNames.join(', ') || '(none)'}.`,
      )
    }

    // `DerivedFileSourceRef` only lets callers pass the reference type this
    // source declares
    const source = sources[name] as DerivedFileSource<unknown>
    const id = source.key ? source.key(value) : value

    if (typeof id !== 'string' || id === '') {
      throw new UploadError(
        'CONFIGURATION',
        `Source '${name}' got a reference that is not a string. Give the ` +
          'source a key() function that turns its references into strings, ' +
          'or pass string references.',
      )
    }

    return { name, ref: value, key: `${name}:${id}`, read: source.read }
  }

  const findUpload = (id: string) =>
    db.upload.findFirst({ where: { id }, omit: { data: true } })

  const deleteUpload = async (id: string) => {
    const upload = await findUpload(id)

    if (upload) {
      await deleteFile(resolveTarget(targets, upload.target), { db, upload })
    }
  }

  /**
   * Deletes a made file, then its row, but the row only in the state its
   * file was deleted for: an attempt that finishes in between gives the row
   * a file, which is then deleted too.
   */
  const deleteRow = async (row: DerivedFileRecord) => {
    for (let current: DerivedFileRecord | null = row; current;) {
      if (current.uploadId) {
        await deleteUpload(current.uploadId)
      }

      const { id, status, claimId, uploadId }: DerivedFileRecord = current
      const { count } = await db.derivedFile.deleteMany({
        where: { id, status, claimId, uploadId },
      })

      current = count ? null : await db.derivedFile.findFirst({ where: { id } })
    }
  }

  /** Makes the file under the claim `claimId` on row `id`. */
  const make = async (
    source: ReturnType<typeof sourceOf>,
    name: string,
    id: string,
    claimId: string,
    attempts: number,
  ): Promise<DerivedFileResult> => {
    const { generate, target } = definitionOf(name)
    const info = { source: source.key, variant: name }
    const settle = async (status: 'pending' | 'failed') => {
      await db.derivedFile.updateMany({
        where: { id, claimId },
        data: { status, claimId: null },
      })

      return status === 'failed' ? FAILED : PENDING
    }

    let read: ReturnType<DerivedFileContext['readSource']> | undefined
    const readSource = () =>
      (read ??= Promise.resolve(source.read(source.ref)).then((file) => {
        if (!file) {
          throw new SourceGone()
        }

        const { buffer, byteOffset, byteLength } = file.data
        return { ...file, data: Buffer.from(buffer, byteOffset, byteLength) }
      }))

    let made: UploadRecord | undefined

    try {
      const file = await generate({
        source: { name: source.name, key: source.key, ref: source.ref },
        variant: name,
        readSource,
      })

      if (file) {
        const from = await readSource()
        const base = from.filename?.replace(/\.[^./\\]*$/, '') || 'file'
        const ext = mime.extension(file.mimeType.split(';')[0].trim())

        made = await storeFile(target, {
          db,
          filename: file.filename ?? `${base}-${name}${ext ? `.${ext}` : ''}`,
          mimeType: file.mimeType,
          data: file.data,
          userId: from.userId ?? undefined,
          organizationId: from.organizationId ?? undefined,
        })
      }
    } catch (e) {
      if (e instanceof SourceGone) {
        return settle('failed')
      }

      onError(e, info)

      // A file storeFile() refuses is refused again on every attempt
      const refused =
        e instanceof UploadError &&
        (e.code === 'MIME_TYPE_NOT_ALLOWED' || e.code === 'FILE_TOO_LARGE')

      return settle(refused || attempts >= maxAttempts ? 'failed' : 'pending')
    }

    if (!made) {
      return settle('failed')
    }

    const madeId = made.id
    const dropMade = () =>
      deleteUpload(madeId).catch((e: unknown) => onError(e, info))
    const { count } = await db.derivedFile
      .updateMany({
        where: { id, claimId },
        data: { status: 'completed', uploadId: madeId, claimId: null },
      })
      .catch(async (e: unknown) => {
        await dropMade()
        throw e
      })

    if (count !== 1) {
      // The claim was lost meanwhile (`deleteFor()`, `resetVariants()`, or a
      // takeover), so nothing references the made file
      await dropMade()
      return PENDING
    }

    const upload = await findUpload(madeId)
    return upload ? { status: 'completed', upload } : PENDING
  }

  /**
   * The claim on a derived file is its row in `pending` status with a random
   * `claimId`; the unique index on `(source, variant)` lets one process
   * create the row, and conditional updates let one process take it over.
   */
  const obtain = async (
    source: ReturnType<typeof sourceOf>,
    name: string,
  ): Promise<DerivedFileResult> => {
    const row = await db.derivedFile.findFirst({
      where: { source: source.key, variant: name },
    })
    const claimId = randomUUID()
    const claim = async (current: DerivedFileRecord, attempts: number) => {
      const { id, status, attempts: before } = current
      const { count } = await db.derivedFile.updateMany({
        where: { id, status, claimId: current.claimId, attempts: before },
        data: { status: 'pending', claimId, attempts, uploadId: null },
      })

      return count ? make(source, name, id, claimId, attempts) : PENDING
    }

    if (!row) {
      try {
        const { id } = await db.derivedFile.create({
          data: {
            source: source.key,
            variant: name,
            status: 'pending',
            claimId,
            attempts: 1,
          },
        })

        return await make(source, name, id, claimId, 1)
      } catch (e) {
        // Another process created the row first, and is making the file
        if (typeof e === 'object' && e && 'code' in e && e.code === 'P2002') {
          return PENDING
        }

        throw e
      }
    }

    if (row.status === 'completed') {
      const upload = row.uploadId ? await findUpload(row.uploadId) : null

      // A made file deleted some other way is made again
      return upload ? { status: 'completed', upload } : claim(row, 1)
    }

    // Absolute timestamps, so time zones don't matter, but the processes'
    // clocks must be roughly in sync
    const age = Date.now() - row.updatedAt.getTime()

    if (row.status === 'failed') {
      return FAILED
    } else if (row.claimId === null) {
      // Waiting for its retry
      const wait = retryDelay * 2 ** (row.attempts - 1)
      return age < wait ? PENDING : claim(row, row.attempts + 1)
    } else if (age < claimTimeout) {
      // Another attempt is making it
      return PENDING
    } else if (row.attempts < maxAttempts) {
      return claim(row, row.attempts + 1)
    }

    // The last attempt allowed died
    const { count } = await db.derivedFile.updateMany({
      where: { id: row.id, claimId: row.claimId },
      data: { status: 'failed', claimId: null },
    })

    return count ? FAILED : PENDING
  }

  const acquireVariant = async (ref: object, name: Name) => {
    definitionOf(name)

    const source = sourceOf(ref)
    const key = `${source.key}\0${name}`
    const attempt = inFlight.get(key) ?? obtain(source, name)

    if (!inFlight.has(key)) {
      inFlight.set(key, attempt)
      await attempt.catch(() => null)
      inFlight.delete(key)
    }

    return attempt
  }

  const findVariants = async (refs: object[], name: Name) => {
    definitionOf(name)

    const keys = refs.map((ref) => sourceOf(ref).key)
    const rows = keys.length
      ? await db.derivedFile.findMany({
          where: { source: { in: keys }, variant: name, status: 'completed' },
        })
      : []
    const ids = rows.flatMap((row) => (row.uploadId ? [row.uploadId] : []))
    const uploads = ids.length
      ? await db.upload.findMany({
          where: { id: { in: ids } },
          omit: { data: true },
        })
      : []
    const bySource = new Map(
      rows.map((row) => [
        row.source,
        uploads.find((upload) => upload.id === row.uploadId) ?? null,
      ]),
    )

    return keys.map((key) => bySource.get(key) ?? null)
  }

  const deleteFor = async (ref: object) => {
    const rows = await db.derivedFile.findMany({
      where: { source: sourceOf(ref).key },
    })

    for (const row of rows) {
      await deleteRow(row)
    }

    return rows.length
  }

  return {
    names,
    acquireVariant,
    acquireVariantData: async (ref, name) => {
      const result = await acquireVariant(ref, name)

      return result.status === 'completed'
        ? {
            upload: result.upload,
            data: await readBytes(db, targets, result.upload),
          }
        : null
    },
    findVariant: async (ref, name) => (await findVariants([ref], name))[0],
    findVariants,
    resetVariants: async (name) => {
      definitionOf(name)

      const result = { deleted: 0, errors: 0 }
      let after: string | undefined

      for (;;) {
        const rows = await db.derivedFile.findMany({
          where: { variant: name, ...(after && { id: { gt: after } }) },
          orderBy: { id: 'asc' },
          take: 100,
        })

        if (rows.length === 0) {
          return result
        }

        for (const row of rows) {
          try {
            await deleteRow(row)
            result.deleted += 1
          } catch (e) {
            result.errors += 1
            onError(e, { source: row.source, variant: name })
          }
        }

        after = rows[rows.length - 1].id
      }
    },
    deleteFor,
    deleteForUpload: async (upload) => {
      const name = sourceNames.find((n) => uploadSources.has(sources[n]))

      if (!name) {
        throw new UploadError(
          'CONFIGURATION',
          'These derived files have no upload source, so none can be ' +
            'deleted for an upload. Add `upload: uploadSource({ db, ' +
            'targets })` to `sources`, or call deleteFile() without ' +
            '`derivedFiles`.',
        )
      }

      return deleteFor({ [name]: upload })
    },
  }
}
