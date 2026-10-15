import { setTimeout as sleep } from 'node:timers/promises'

import { beforeEach, describe, expect, test, vi } from 'vitest'

import { deleteFile } from '../deleteFile.js'
import type { DerivedFileGenerator } from '../derivedFiles.js'
import { defineDerivedFiles, uploadSource } from '../derivedFiles.js'
import { createDbProvider } from '../providers/db.js'
import { storeFile } from '../storeFile.js'
import { defineStorageTargets } from '../targets.js'
import type { DerivedFileDatabase, DerivedFileDelegate } from '../types.js'

import { createMemoryProvider } from './helpers/memoryProvider.js'
import { derivedDb as db, prisma, resetTestDb } from './helpers/testDb.js'

const MINUTE = 60 * 1000

function makeTargets() {
  return defineStorageTargets({
    files: createMemoryProvider(),
    thumbs: createMemoryProvider(),
    inline: createDbProvider(),
  })
}

type Targets = ReturnType<typeof makeTargets>

interface DocRef {
  org: string
  doc: string
}

/** A trivial generator: the source's bytes, upper-cased, with a tag. */
function upperCase(tag: string): DerivedFileGenerator {
  return async ({ readSource }) => ({
    data: Buffer.from(
      `${tag}:${(await readSource()).data.toString().toUpperCase()}`,
    ),
    mimeType: 'text/plain',
  })
}

async function storeSource(targets: Targets, text = 'photo') {
  return storeFile(targets.files, {
    db,
    filename: 'photo.jpg',
    mimeType: 'image/jpeg',
    data: Buffer.from(text),
    userId: 'user_1',
    organizationId: 'org_1',
  })
}

function setup(
  targets: Targets,
  variants: Record<string, DerivedFileGenerator>,
  options: {
    db?: DerivedFileDatabase
    onError?: (error: unknown) => void
    documents?: Map<string, string>
  } = {},
) {
  const documents = options.documents ?? new Map<string, string>()

  return defineDerivedFiles({
    db: options.db ?? db,
    targets,
    target: targets.thumbs,
    sources: {
      upload: uploadSource({ db, targets }),
      // A source outside uploads, like documents fetched from a third-party
      // API: referenced by an object, keyed by a string built from it
      doc: {
        key: (ref: DocRef) => `${ref.org}/${ref.doc}`,
        read: (ref: DocRef) => {
          const text = documents.get(ref.doc)

          return text === undefined
            ? null
            : {
                data: Buffer.from(text),
                filename: `${ref.doc}.pdf`,
                organizationId: ref.org,
              }
        },
      },
    },
    variants,
    onError: options.onError ?? (() => undefined),
  })
}

/** The test database, with some `DerivedFile` calls replaced. */
function withDerivedFile(
  overrides: Partial<DerivedFileDelegate>,
): DerivedFileDatabase {
  const base = db.derivedFile

  return {
    upload: db.upload,
    $transaction: (fn, options) => db.$transaction(fn, options),
    derivedFile: {
      create: (args) => base.create(args),
      findFirst: (args) => base.findFirst(args),
      findMany: (args) => base.findMany(args),
      updateMany: (args) => base.updateMany(args),
      deleteMany: (args) => base.deleteMany(args),
      ...overrides,
    },
  }
}

async function backdate(source: string, ms: number) {
  await prisma.derivedFile.updateMany({
    where: { source },
    data: { updatedAt: new Date(Date.now() - ms) },
  })
}

describe('defineDerivedFiles', () => {
  beforeEach(resetTestDb)

  test('makes a derived file of an upload on acquire, and finds it after', async () => {
    const targets = makeTargets()
    const source = await storeSource(targets)
    const generate = vi.fn(upperCase('small'))
    const derived = setup(targets, { small: generate })

    expect(await derived.findVariant({ upload: source.id }, 'small')).toBe(null)

    const read = await derived.acquireVariantData({ upload: source }, 'small')

    expect(read?.data.toString()).toBe('small:PHOTO')
    expect(read?.upload).toMatchObject({
      target: 'thumbs',
      status: 'completed',
      mimeType: 'text/plain',
      filename: 'photo-small.txt',
      size: 11n,
      userId: 'user_1',
      organizationId: 'org_1',
    })
    expect(read?.upload).not.toHaveProperty('data')
    expect(await prisma.derivedFile.findFirstOrThrow()).toMatchObject({
      source: `upload:${source.id}`,
      variant: 'small',
      uploadId: read?.upload.id,
      status: 'completed',
      claimId: null,
      attempts: 1,
    })
    expect(targets.thumbs.objects.size).toBe(1)

    // Made once; later acquires find it
    expect(
      await derived.acquireVariant({ upload: source.id }, 'small'),
    ).toEqual({ status: 'completed', upload: read?.upload })
    expect(
      await derived.findVariant({ upload: source.id }, 'small'),
    ).toMatchObject({ id: read?.upload.id })
    expect(generate).toHaveBeenCalledTimes(1)
  })

  test('makes derived files of a source outside uploads', async () => {
    const targets = makeTargets()
    const documents = new Map([['d1', 'invoice']])
    const derived = setup(targets, { preview: upperCase('p') }, { documents })
    const ref = { doc: { org: 'org_9', doc: 'd1' } }

    const read = await derived.acquireVariantData(ref, 'preview')

    expect(read?.data.toString()).toBe('p:INVOICE')
    expect(read?.upload).toMatchObject({
      filename: 'd1-preview.txt',
      organizationId: 'org_9',
      userId: null,
    })
    expect(await prisma.derivedFile.findFirstOrThrow()).toMatchObject({
      source: 'doc:org_9/d1',
    })

    expect(await derived.deleteFor(ref)).toBe(1)
    expect(await prisma.derivedFile.count()).toBe(0)
    expect(await prisma.upload.count()).toBe(0)
    expect(targets.thumbs.objects.size).toBe(0)
  })

  test('stores files inline on a database target', async () => {
    const targets = makeTargets()
    const source = await storeSource(targets)
    const derived = defineDerivedFiles({
      db,
      targets,
      target: targets.inline,
      sources: { upload: uploadSource({ db, targets }) },
      variants: { small: upperCase('s') },
    })

    const read = await derived.acquireVariantData(
      { upload: source.id },
      'small',
    )

    expect(read?.upload).toMatchObject({ target: 'inline', storageKey: null })
    expect(read?.data.toString()).toBe('s:PHOTO')
    expect(targets.thumbs.objects.size).toBe(0)
  })

  test('concurrent acquires in one process run the generator once', async () => {
    const targets = makeTargets()
    const source = await storeSource(targets)
    let calls = 0
    const derived = setup(targets, {
      small: async (context) => {
        calls += 1
        await sleep(30)
        return upperCase('s')(context)
      },
    })

    const [a, b] = await Promise.all([
      derived.acquireVariant({ upload: source.id }, 'small'),
      derived.acquireVariant({ upload: source.id }, 'small'),
    ])

    expect(calls).toBe(1)
    expect(a).toEqual(b)
    expect(a.status).toBe('completed')
    expect(targets.thumbs.objects.size).toBe(1)
  })

  test('another process making the file is reported as pending, not waited for', async () => {
    const targets = makeTargets()
    const source = await storeSource(targets)
    const release = Promise.withResolvers<void>()
    const started = Promise.withResolvers<void>()
    let calls = 0
    const generate: DerivedFileGenerator = async (context) => {
      calls += 1
      started.resolve()
      await release.promise
      return upperCase('s')(context)
    }
    // Two instances share no in-process state, like two api processes; only
    // the database is shared
    const processA = setup(targets, { small: generate })
    const processB = setup(targets, { small: generate })

    const making = processA.acquireVariant({ upload: source.id }, 'small')
    await started.promise

    expect(
      await processB.acquireVariant({ upload: source.id }, 'small'),
    ).toEqual({ status: 'pending' })

    release.resolve()
    expect((await making).status).toBe('completed')
    expect(
      (await processB.acquireVariant({ upload: source.id }, 'small')).status,
    ).toBe('completed')
    expect(calls).toBe(1)
  })

  test('a claim whose maker died is taken over after claimTimeout, and fails once out of attempts', async () => {
    const targets = makeTargets()
    const one = await storeSource(targets, 'one')
    const two = await storeSource(targets, 'two')
    const derived = setup(targets, { small: upperCase('s') })

    for (const [upload, attempts] of [
      [one, 1],
      [two, 3],
    ] as const) {
      await prisma.derivedFile.create({
        data: {
          source: `upload:${upload.id}`,
          variant: 'small',
          status: 'pending',
          claimId: 'dead-process',
          attempts,
        },
      })
    }

    // Still within claimTimeout
    expect(await derived.acquireVariant({ upload: one.id }, 'small')).toEqual({
      status: 'pending',
    })

    await backdate(`upload:${one.id}`, 11 * MINUTE)
    await backdate(`upload:${two.id}`, 11 * MINUTE)

    expect(
      (await derived.acquireVariant({ upload: one.id }, 'small')).status,
    ).toBe('completed')
    expect(
      await prisma.derivedFile.findFirstOrThrow({
        where: { source: `upload:${one.id}` },
      }),
    ).toMatchObject({ attempts: 2 })
    expect(await derived.acquireVariant({ upload: two.id }, 'small')).toEqual({
      status: 'failed',
    })
  })

  test('a thrown error is retried with backoff, then remembered as failed', async () => {
    const targets = makeTargets()
    const source = await storeSource(targets)
    const key = `upload:${source.id}`
    const onError = vi.fn()
    const generate = vi.fn<DerivedFileGenerator>(() => {
      throw new Error('service down')
    })
    const derived = setup(targets, { small: generate }, { onError })
    const acquire = () => derived.acquireVariant({ upload: source.id }, 'small')

    expect(await acquire()).toEqual({ status: 'pending' })
    expect(onError).toHaveBeenCalledWith(expect.any(Error), {
      source: key,
      variant: 'small',
    })
    expect(await prisma.derivedFile.findFirstOrThrow()).toMatchObject({
      status: 'pending',
      claimId: null,
      attempts: 1,
    })

    // Not before the retry delay: one minute, then two
    expect(await acquire()).toEqual({ status: 'pending' })
    expect(generate).toHaveBeenCalledTimes(1)

    await backdate(key, 1.5 * MINUTE)
    expect(await acquire()).toEqual({ status: 'pending' })
    expect(generate).toHaveBeenCalledTimes(2)

    await backdate(key, 1.5 * MINUTE)
    expect(await acquire()).toEqual({ status: 'pending' })
    expect(generate).toHaveBeenCalledTimes(2)

    // The third and last attempt
    await backdate(key, 2.5 * MINUTE)
    expect(await acquire()).toEqual({ status: 'failed' })
    expect(generate).toHaveBeenCalledTimes(3)

    // Failed stays failed
    await backdate(key, 60 * MINUTE)
    expect(await acquire()).toEqual({ status: 'failed' })
    expect(generate).toHaveBeenCalledTimes(3)
    expect(await prisma.upload.count()).toBe(1)
  })

  test('a retried attempt can succeed', async () => {
    const targets = makeTargets()
    const source = await storeSource(targets)
    let broken = true
    const derived = setup(targets, {
      small: async (context) => {
        if (broken) {
          throw new Error('blip')
        }

        return upperCase('s')(context)
      },
    })

    expect(
      (await derived.acquireVariant({ upload: source.id }, 'small')).status,
    ).toBe('pending')

    broken = false
    await backdate(`upload:${source.id}`, 2 * MINUTE)

    expect(
      (await derived.acquireVariant({ upload: source.id }, 'small')).status,
    ).toBe('completed')
  })

  test('null from a generator or a source is a permanent failure, until resetVariants', async () => {
    const targets = makeTargets()
    const source = await storeSource(targets)
    const onError = vi.fn()
    let handles = false
    const generate = vi.fn<DerivedFileGenerator>((context) =>
      handles ? upperCase('p')(context) : null,
    )
    const derived = setup(targets, { poster: generate }, { onError })
    const acquire = () =>
      derived.acquireVariant({ upload: source.id }, 'poster')

    expect(await acquire()).toEqual({ status: 'failed' })
    expect(await acquire()).toEqual({ status: 'failed' })
    expect(
      await derived.acquireVariant(
        { doc: { org: 'o', doc: 'gone' } },
        'poster',
      ),
    ).toEqual({ status: 'failed' })
    expect(generate).toHaveBeenCalledTimes(2)
    expect(onError).not.toHaveBeenCalled()

    handles = true
    expect(await derived.resetVariants('poster')).toEqual({
      deleted: 2,
      errors: 0,
    })
    expect((await acquire()).status).toBe('completed')
  })

  test('a made file that cannot be stored is a permanent failure', async () => {
    const targets = makeTargets()
    const source = await storeSource(targets)
    const onError = vi.fn()
    const derived = setup(
      targets,
      { weird: () => ({ data: Buffer.from('x'), mimeType: 'not a type' }) },
      { onError },
    )

    expect(
      await derived.acquireVariant({ upload: source.id }, 'weird'),
    ).toEqual({ status: 'failed' })
    expect(onError.mock.calls[0][0]).toMatchObject({
      code: 'MIME_TYPE_NOT_ALLOWED',
    })
  })

  test('an upload that is not completed yet is retried, not failed', async () => {
    const targets = makeTargets()
    const pending = await prisma.upload.create({
      data: {
        target: 'files',
        status: 'pending',
        filename: 'p.jpg',
        mimeType: 'image/jpeg',
        size: 1n,
      },
    })
    const onError = vi.fn()
    const derived = setup(targets, { small: upperCase('s') }, { onError })

    expect(
      await derived.acquireVariant({ upload: pending.id }, 'small'),
    ).toEqual({ status: 'pending' })
    expect(onError.mock.calls[0][0]).toMatchObject({ code: 'NOT_FOUND' })
  })

  test('refuses invalid configuration and references, naming the way out', async () => {
    const targets = makeTargets()
    const unregistered = defineStorageTargets({
      thumbs: createMemoryProvider(),
    })

    expect(() => setup(targets, { '../x': upperCase('x') })).toThrow(
      /Invalid variant name/,
    )
    expect(() =>
      defineDerivedFiles({
        db,
        targets,
        target: targets.thumbs,
        sources: { 'up:load': uploadSource({ db, targets }) },
        variants: {},
      }),
    ).toThrow(/Invalid derived-file source 'up:load'/)
    expect(() =>
      defineDerivedFiles({
        db,
        targets,
        target: targets.thumbs,
        sources: {},
        variants: {
          small: { generate: upperCase('s'), target: unregistered.thumbs },
        },
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'CONFIGURATION',
        message: expect.stringContaining("Variant 'small'"),
      }),
    )

    const derived = setup(targets, { small: upperCase('s') })

    await expect(
      // @ts-expect-error - 'large' is not a configured variant
      derived.acquireVariant({ upload: 'x' }, 'large'),
    ).rejects.toMatchObject({
      code: 'CONFIGURATION',
      message: expect.stringContaining('Configured variants: small'),
    })
    await expect(
      // @ts-expect-error - 'video' is not a configured source
      derived.acquireVariant({ video: 'x' }, 'small'),
    ).rejects.toMatchObject({
      message: expect.stringContaining('Configured sources: upload, doc'),
    })

    // Two sources in one reference
    const both = { upload: 'x', doc: { org: 'o', doc: 'd' } }
    await expect(derived.acquireVariant(both, 'small')).rejects.toMatchObject({
      code: 'CONFIGURATION',
    })

    const keyless = defineDerivedFiles({
      db,
      targets,
      target: targets.thumbs,
      sources: { doc: { read: (_ref: { id: number }) => null } },
      variants: { small: upperCase('s') },
    })

    await expect(
      keyless.acquireVariant({ doc: { id: 1 } }, 'small'),
    ).rejects.toMatchObject({
      message: expect.stringContaining('Give the source a key() function'),
    })
  })

  test('findVariants returns made files of many sources, in order', async () => {
    const targets = makeTargets()
    const one = await storeSource(targets, 'one')
    const two = await storeSource(targets, 'two')
    const three = await storeSource(targets, 'three')
    const derived = setup(targets, { small: upperCase('s') })

    const madeOne = await derived.acquireVariant({ upload: one.id }, 'small')
    const madeThree = await derived.acquireVariant(
      { upload: three.id },
      'small',
    )

    const found = await derived.findVariants(
      [{ upload: one.id }, { upload: two.id }, { upload: three.id }],
      'small',
    )

    expect(found).toEqual([
      madeOne.status === 'completed' ? madeOne.upload : 'not made',
      null,
      madeThree.status === 'completed' ? madeThree.upload : 'not made',
    ])
    expect(await derived.findVariants([], 'small')).toEqual([])
  })

  test('a made file whose save fails leaves no file behind', async () => {
    const targets = makeTargets()
    const source = await storeSource(targets)
    const failing = withDerivedFile({
      updateMany: (args) =>
        args.data.status === 'completed'
          ? Promise.reject(new Error('database down'))
          : db.derivedFile.updateMany(args),
    })
    const derived = setup(targets, { small: upperCase('s') }, { db: failing })

    await expect(
      derived.acquireVariant({ upload: source.id }, 'small'),
    ).rejects.toThrow('database down')
    expect(targets.thumbs.objects.size).toBe(0)
    expect(await prisma.upload.count()).toBe(1)
  })

  test('a made file deleted some other way is made again', async () => {
    const targets = makeTargets()
    const source = await storeSource(targets)
    const derived = setup(targets, { small: upperCase('s') })

    const first = await derived.acquireVariant({ upload: source.id }, 'small')
    const firstId = first.status === 'completed' ? first.upload.id : ''
    await prisma.upload.delete({ where: { id: firstId } })

    const again = await derived.acquireVariant({ upload: source.id }, 'small')

    expect(again.status).toBe('completed')
    expect(again.status === 'completed' && again.upload.id).not.toBe(firstId)
    expect(await prisma.derivedFile.count()).toBe(1)
  })
})

describe('resetVariants', () => {
  beforeEach(resetTestDb)

  test('deletes every file of one variant, made or failed, and leaves the others alone', async () => {
    const targets = makeTargets()
    const one = await storeSource(targets, 'one')
    const two = await storeSource(targets, 'two')
    let version = 1
    const derived = setup(targets, {
      small: async ({ source, readSource }) =>
        source.key.endsWith(two.id) && version === 1
          ? null
          : {
              data: Buffer.from(`v${version}:${(await readSource()).data}`),
              mimeType: 'text/plain',
            },
      large: upperCase('large'),
    })

    await derived.acquireVariant({ upload: one.id }, 'small')
    await derived.acquireVariant({ upload: two.id }, 'small')
    const large = await derived.acquireVariant({ upload: one.id }, 'large')
    expect(targets.thumbs.objects.size).toBe(2)

    version = 2
    expect(await derived.resetVariants('small', { batchSize: 1 })).toEqual({
      deleted: 2,
      errors: 0,
    })
    expect(targets.thumbs.objects.size).toBe(1)

    const readSmall = async (id: string) =>
      (
        await derived.acquireVariantData({ upload: id }, 'small')
      )?.data.toString()

    expect(await readSmall(one.id)).toBe('v2:one')
    expect(await readSmall(two.id)).toBe('v2:two')
    expect(await derived.acquireVariant({ upload: one.id }, 'large')).toEqual(
      large,
    )
  })

  test('a file still being made when it is reset leaves nothing behind', async () => {
    const targets = makeTargets()
    const source = await storeSource(targets)
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const derived = setup(targets, {
      small: async (context) => {
        started.resolve()
        await release.promise
        return upperCase('s')(context)
      },
    })

    const making = derived.acquireVariant({ upload: source.id }, 'small')
    await started.promise

    expect(await derived.resetVariants('small')).toEqual({
      deleted: 1,
      errors: 0,
    })
    release.resolve()

    expect(await making).toEqual({ status: 'pending' })
    expect(targets.thumbs.objects.size).toBe(0)
    expect(await prisma.derivedFile.count()).toBe(0)
    expect(await prisma.upload.count()).toBe(1)
  })
})

describe('deleting', () => {
  beforeEach(resetTestDb)

  test('deleteFile with derivedFiles deletes the upload and its derived files', async () => {
    const targets = makeTargets()
    const source = await storeSource(targets)
    const other = await storeSource(targets, 'other')
    const derived = defineDerivedFiles({
      db,
      targets,
      target: targets.thumbs,
      sources: { upload: uploadSource({ db, targets }) },
      variants: {
        small: upperCase('s'),
        large: upperCase('l'),
        inline: { generate: upperCase('i'), target: targets.inline },
      },
    })

    await derived.acquireVariant({ upload: source.id }, 'small')
    await derived.acquireVariant({ upload: source.id }, 'large')
    await derived.acquireVariant({ upload: source.id }, 'inline')
    await derived.acquireVariant({ upload: other.id }, 'small')
    expect(targets.thumbs.objects.size).toBe(3)

    await deleteFile(targets.files, {
      db,
      upload: source,
      derivedFiles: derived,
    })

    expect(await prisma.upload.findUnique({ where: { id: source.id } })).toBe(
      null,
    )
    expect(targets.files.objects.has(source.storageKey!)).toBe(false)
    // The other upload and its derived file are left
    expect(await prisma.derivedFile.count()).toBe(1)
    expect(await prisma.upload.count()).toBe(2)
    expect(targets.thumbs.objects.size).toBe(1)
  })

  test('deleteFile with derived files that have no upload source refuses before deleting anything', async () => {
    const targets = makeTargets()
    const source = await storeSource(targets)
    const derived = defineDerivedFiles({
      db,
      targets,
      target: targets.thumbs,
      sources: { doc: { read: () => null } },
      variants: {},
    })

    await expect(
      deleteFile(targets.files, { db, upload: source, derivedFiles: derived }),
    ).rejects.toMatchObject({
      code: 'CONFIGURATION',
      message: expect.stringContaining('uploadSource({ db, targets })'),
    })
    expect(targets.files.objects.has(source.storageKey!)).toBe(true)
  })

  test('a file finished while its row is being deleted is deleted too', async () => {
    const targets = makeTargets()
    const source = await storeSource(targets)
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const derived = setup(targets, {
      small: async (context) => {
        const made = await upperCase('s')(context)
        started.resolve()
        await release.promise
        return made
      },
    })

    const making = derived.acquireVariant({ upload: source.id }, 'small')
    await started.promise

    // The file is saved after its pending row was read for deletion, and
    // before that row is deleted
    let raced = false
    const racing = setup(
      targets,
      { small: upperCase('s') },
      {
        db: withDerivedFile({
          deleteMany: async (args) => {
            if (!raced) {
              raced = true
              release.resolve()
              await making
            }

            return db.derivedFile.deleteMany(args)
          },
        }),
      },
    )

    expect(await racing.deleteFor({ upload: source.id })).toBe(1)
    expect((await making).status).toBe('completed')
    expect(targets.thumbs.objects.size).toBe(0)
    expect(await prisma.derivedFile.count()).toBe(0)
    expect(await prisma.upload.count()).toBe(1)
  })

  test('a file finished after its source was deleted leaves nothing behind', async () => {
    const targets = makeTargets()
    const source = await storeSource(targets)
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const derived = setup(targets, {
      small: async (context) => {
        const made = await upperCase('s')(context)
        started.resolve()
        await release.promise
        return made
      },
    })

    const making = derived.acquireVariant({ upload: source.id }, 'small')
    await started.promise

    await deleteFile(targets.files, {
      db,
      upload: source,
      derivedFiles: derived,
    })
    release.resolve()

    expect(await making).toEqual({ status: 'pending' })
    expect(targets.thumbs.objects.size).toBe(0)
    expect(await prisma.upload.count()).toBe(0)
    expect(await prisma.derivedFile.count()).toBe(0)
  })
})
