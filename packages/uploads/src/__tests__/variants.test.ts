import { setTimeout as sleep } from 'node:timers/promises'

import { beforeEach, describe, expect, test, vi } from 'vitest'

import { cleanupStaleUploads } from '../cleanupStaleUploads.js'
import { deleteFile } from '../deleteFile.js'
import { createDbProvider } from '../providers/db.js'
import { storeFile } from '../storeFile.js'
import { defineStorageTargets } from '../targets.js'
import type { UploadVariantDatabase, UploadVariantDelegate } from '../types.js'
import type { UploadVariantGenerator } from '../variants.js'
import { defineUploadVariants, deleteVariants } from '../variants.js'

import { createMemoryProvider } from './helpers/memoryProvider.js'
import { prisma, resetTestDb, variantDb as db } from './helpers/testDb.js'

const DAY = 24 * 60 * 60 * 1000

function makeTargets() {
  return defineStorageTargets({
    files: createMemoryProvider(),
    thumbs: createMemoryProvider(),
    inline: createDbProvider(),
  })
}

type Targets = ReturnType<typeof makeTargets>

/** A trivial generator: the source's bytes, upper-cased, with a tag. */
function upperCase(tag: string): UploadVariantGenerator {
  return async ({ readSource }) => ({
    data: Buffer.from(
      `${tag}:${(await readSource()).toString().toUpperCase()}`,
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

/** The test database, with some `Upload` calls replaced. */
function withUpload(
  overrides: Partial<UploadVariantDelegate>,
): UploadVariantDatabase {
  const base: UploadVariantDatabase = db

  return {
    upload: {
      create: (args) => base.upload.create(args),
      findUnique: (args) => base.upload.findUnique(args),
      findFirst: (args) => base.upload.findFirst(args),
      findMany: (args) => base.upload.findMany(args),
      updateMany: (args) => base.upload.updateMany(args),
      deleteMany: (args) => base.upload.deleteMany(args),
      ...overrides,
    },
  }
}

async function backdate(id: string, ms: number) {
  await prisma.upload.update({
    where: { id },
    data: { updatedAt: new Date(Date.now() - ms) },
  })
}

describe('defineUploadVariants', () => {
  beforeEach(resetTestDb)

  test('makes a variant that does not exist yet on read, and stores it linked to its source', async () => {
    const targets = makeTargets()
    const source = await storeSource(targets)
    const generate = vi.fn(upperCase('small'))
    const variants = defineUploadVariants({
      db,
      targets,
      target: targets.thumbs,
      variants: { small: generate },
    })

    expect(await variants.findVariant(source, 'small')).toBeNull()

    const read = await variants.readVariant(source.id, 'small')

    expect(read?.data.toString()).toBe('small:PHOTO')
    expect(read?.upload).toMatchObject({
      sourceId: source.id,
      variant: 'small',
      target: 'thumbs',
      status: 'completed',
      mimeType: 'text/plain',
      filename: 'photo-small.txt',
      size: 11n,
      userId: 'user_1',
      organizationId: 'org_1',
      tokenId: null,
    })
    expect(targets.thumbs.objects.size).toBe(1)

    // Made once; later reads find it
    expect((await variants.getVariant(source, 'small'))?.id).toBe(
      read?.upload.id,
    )
    expect(await variants.findVariant(source, 'small')).toMatchObject({
      id: read?.upload.id,
    })
    expect(generate).toHaveBeenCalledTimes(1)
  })

  test('stores variants inline on a database target and serves them as data URIs', async () => {
    const targets = makeTargets()
    const source = await storeSource(targets)
    const variants = defineUploadVariants({
      db,
      targets,
      target: targets.inline,
      variants: { small: upperCase('s') },
    })

    const url = await variants.getVariantUrl(source, 'small')

    expect(url).toBe(
      `data:text/plain;base64,${Buffer.from('s:PHOTO').toString('base64')}`,
    )
  })

  test('serves object-storage variants with a signed URL', async () => {
    const targets = makeTargets()
    const source = await storeSource(targets)
    const variants = defineUploadVariants({
      db,
      targets,
      target: targets.thumbs,
      variants: { small: upperCase('s') },
    })

    const url = await variants.getVariantUrl(source, 'small', {
      disposition: 'inline',
    })
    const upload = await variants.findVariant(source, 'small')

    expect(url).toBe(`memory://thumbs/${upload?.storageKey}?disposition=inline`)
  })

  test('two concurrent requests in one process run the generator once', async () => {
    const targets = makeTargets()
    const source = await storeSource(targets)
    let calls = 0
    const variants = defineUploadVariants({
      db,
      targets,
      target: targets.thumbs,
      variants: {
        small: async (context) => {
          calls += 1
          await sleep(30)
          return upperCase('s')(context)
        },
      },
    })

    const [a, b] = await Promise.all([
      variants.getVariant(source, 'small'),
      variants.getVariant(source, 'small'),
    ])

    expect(calls).toBe(1)
    expect(a?.id).toBe(b?.id)
    expect(targets.thumbs.objects.size).toBe(1)
  })

  test('two concurrent requests from separate processes run the generator once', async () => {
    const targets = makeTargets()
    const source = await storeSource(targets)
    let calls = 0
    const generate: UploadVariantGenerator = async (context) => {
      calls += 1
      await sleep(50)
      return upperCase('s')(context)
    }
    // Two instances share no in-process state, like two api processes; only
    // the database is shared
    const processA = defineUploadVariants({
      db,
      targets,
      target: targets.thumbs,
      variants: { small: generate },
      pollInterval: 5,
    })
    const processB = defineUploadVariants({
      db,
      targets,
      target: targets.thumbs,
      variants: { small: generate },
      pollInterval: 5,
    })

    const [a, b] = await Promise.all([
      processA.getVariant(source, 'small'),
      processB.getVariant(source, 'small'),
    ])

    expect(calls).toBe(1)
    expect(a?.status).toBe('completed')
    expect(b?.id).toBe(a?.id)
    expect(targets.thumbs.objects.size).toBe(1)
    expect(await prisma.upload.count({ where: { sourceId: source.id } })).toBe(
      1,
    )
  })

  test('takes over a claim whose maker died', async () => {
    const targets = makeTargets()
    const source = await storeSource(targets)
    const variants = defineUploadVariants({
      db,
      targets,
      target: targets.thumbs,
      variants: { small: upperCase('s') },
      claimTimeout: 60_000,
    })
    const abandoned = await prisma.upload.create({
      data: {
        sourceId: source.id,
        variant: 'small',
        target: 'thumbs',
        status: 'pending',
        filename: 'photo-small',
        mimeType: 'application/octet-stream',
        size: 0n,
        tokenId: 'dead-process',
      },
    })
    await backdate(abandoned.id, 120_000)

    const made = await variants.getVariant(source, 'small')

    expect(made).toMatchObject({ id: abandoned.id, status: 'completed' })
  })

  test('remembers a failure and does not retry it until retryFailedAfter has passed', async () => {
    const targets = makeTargets()
    const source = await storeSource(targets)
    const onError = vi.fn()
    let broken = true
    const generate = vi.fn<UploadVariantGenerator>(async (context) => {
      if (broken) {
        throw new Error('cannot decode')
      }

      return upperCase('s')(context)
    })
    const variants = defineUploadVariants({
      db,
      targets,
      target: targets.thumbs,
      variants: { small: generate },
      retryFailedAfter: DAY,
      onError,
    })

    expect(await variants.getVariant(source, 'small')).toBeNull()
    expect(onError).toHaveBeenCalledWith(expect.any(Error), {
      sourceId: source.id,
      variant: 'small',
    })

    const memo = await prisma.upload.findFirstOrThrow({
      where: { sourceId: source.id, variant: 'small' },
    })
    expect(memo).toMatchObject({ status: 'failed', storageKey: null })

    // Fixed, but the failure is remembered: not tried again yet
    broken = false
    expect(await variants.getVariant(source, 'small')).toBeNull()
    expect(await variants.readVariant(source, 'small')).toBeNull()
    expect(generate).toHaveBeenCalledTimes(1)

    // Once retryFailedAfter has passed it is tried again, and made
    await backdate(memo.id, DAY + 1000)
    const made = await variants.getVariant(source, 'small')

    expect(generate).toHaveBeenCalledTimes(2)
    expect(made).toMatchObject({ id: memo.id, status: 'completed' })
    expect(targets.thumbs.objects.size).toBe(1)
  })

  test('remembers a generator that returns null like a failure', async () => {
    const targets = makeTargets()
    const source = await storeSource(targets)
    const generate = vi.fn<UploadVariantGenerator>(() => null)
    const onError = vi.fn()
    const variants = defineUploadVariants({
      db,
      targets,
      target: targets.thumbs,
      variants: { poster: generate },
      onError,
    })

    expect(await variants.getVariant(source, 'poster')).toBeNull()
    expect(await variants.getVariant(source, 'poster')).toBeNull()
    expect(generate).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
  })

  test('makes one variant from another with readVariant', async () => {
    const targets = makeTargets()
    const source = await storeSource(targets, 'pdf')
    const drawPage = vi.fn(upperCase('page'))
    const variants = defineUploadVariants({
      db,
      targets,
      target: targets.thumbs,
      variants: {
        preview: drawPage,
        thumb: async ({ readVariant }) => {
          const page = await readVariant('preview')
          return page
            ? { data: Buffer.from(`thumb of ${page}`), mimeType: 'text/plain' }
            : null
        },
      },
    })

    const thumb = await variants.readVariant(source, 'thumb')

    expect(thumb?.data.toString()).toBe('thumb of page:PDF')
    expect(
      (await variants.readVariant(source, 'preview'))?.data.toString(),
    ).toBe('page:PDF')
    expect(drawPage).toHaveBeenCalledTimes(1)
  })

  test('refuses a variant that depends on itself', async () => {
    const targets = makeTargets()
    const source = await storeSource(targets)
    const onError = vi.fn()
    const variants = defineUploadVariants({
      db,
      targets,
      target: targets.thumbs,
      variants: {
        a: async ({ readVariant }) => {
          await readVariant('a')
          return null
        },
      },
      onError,
    })

    expect(await variants.getVariant(source, 'a')).toBeNull()
    expect(onError.mock.calls[0][0]).toMatchObject({
      code: 'CONFIGURATION',
      message: expect.stringContaining('a -> a'),
    })
  })

  test('rejects unknown variant names, invalid names, and variants of variants', async () => {
    const targets = makeTargets()
    const source = await storeSource(targets)

    expect(() =>
      defineUploadVariants({
        db,
        targets,
        target: targets.thumbs,
        variants: { '../x': upperCase('x') },
      }),
    ).toThrow(/Invalid variant name/)

    const variants = defineUploadVariants({
      db,
      targets,
      target: targets.thumbs,
      variants: { small: upperCase('s') },
    })

    await expect(
      // @ts-expect-error - 'large' is not a configured variant
      variants.getVariant(source, 'large'),
    ).rejects.toMatchObject({
      code: 'CONFIGURATION',
      message: expect.stringContaining('Configured variants: small'),
    })

    const small = await variants.getVariant(source, 'small')

    await expect(variants.getVariant(small!, 'small')).rejects.toMatchObject({
      code: 'NOT_SUPPORTED',
    })
    await expect(variants.getVariant('missing', 'small')).rejects.toMatchObject(
      { code: 'NOT_FOUND' },
    )
  })

  test('findVariants returns made variants of many sources in one call', async () => {
    const targets = makeTargets()
    const one = await storeSource(targets, 'one')
    const two = await storeSource(targets, 'two')
    const three = await storeSource(targets, 'three')
    const variants = defineUploadVariants({
      db,
      targets,
      target: targets.thumbs,
      variants: { small: upperCase('s') },
    })

    await variants.getVariant(one, 'small')
    await variants.getVariant(three, 'small')

    const found = await variants.findVariants(
      [one.id, two.id, three.id],
      'small',
    )

    expect([...found.keys()].sort()).toEqual([one.id, three.id].sort())
  })

  test('a variant whose save fails leaves no file behind', async () => {
    const targets = makeTargets()
    const source = await storeSource(targets)
    const failing = withUpload({
      updateMany: (args) =>
        args.data.status === 'completed'
          ? Promise.reject(new Error('database down'))
          : withUpload({}).upload.updateMany(args),
    })
    const variants = defineUploadVariants({
      db: failing,
      targets,
      target: targets.thumbs,
      variants: { small: upperCase('s') },
    })

    await expect(variants.getVariant(source, 'small')).rejects.toThrow(
      'database down',
    )
    expect(targets.thumbs.objects.size).toBe(0)
  })

  test('a retry stores the target it wrote to', async () => {
    const targets = makeTargets()
    const source = await storeSource(targets)
    const before = defineUploadVariants({
      db,
      targets,
      target: targets.thumbs,
      variants: { small: () => null },
    })

    expect(await before.getVariant(source, 'small')).toBeNull()
    const failed = await prisma.upload.findFirstOrThrow({
      where: { sourceId: source.id },
    })
    expect(failed.target).toBe('thumbs')
    await backdate(failed.id, 2 * DAY)

    // The variant's target changed between the attempts
    const after = defineUploadVariants({
      db,
      targets,
      target: targets.files,
      variants: { small: upperCase('s') },
    })

    expect(await after.getVariant(source, 'small')).toMatchObject({
      target: 'files',
    })
    expect((await after.readVariant(source, 'small'))?.data.toString()).toBe(
      's:PHOTO',
    )
    expect(targets.thumbs.objects.size).toBe(0)
  })

  test('cleanup leaves a retry of an old failed variant alone', async () => {
    const targets = makeTargets()
    const source = await storeSource(targets)
    let broken = true
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const variants = defineUploadVariants({
      db,
      targets,
      target: targets.thumbs,
      variants: {
        small: async (context) => {
          if (broken) {
            return null
          }

          started.resolve()
          await release.promise
          return upperCase('s')(context)
        },
      },
    })

    expect(await variants.getVariant(source, 'small')).toBeNull()
    const failed = await prisma.upload.findFirstOrThrow({
      where: { sourceId: source.id },
    })
    const old = new Date(Date.now() - 2 * DAY)
    await prisma.upload.update({
      where: { id: failed.id },
      data: { createdAt: old, updatedAt: old },
    })

    broken = false
    const making = variants.getVariant(source, 'small')
    await started.promise

    expect(await cleanupStaleUploads({ db, targets })).toMatchObject({
      claimed: 0,
    })

    release.resolve()
    expect(await making).toMatchObject({ status: 'completed' })
  })

  test('variants that read each other, started together, are refused', async () => {
    const targets = makeTargets()
    const source = await storeSource(targets)
    const onError = vi.fn()
    let started = 0
    const bothStarted = Promise.withResolvers<void>()
    const readsOther =
      (other: 'a' | 'b'): UploadVariantGenerator =>
      async ({ readVariant }) => {
        started += 1

        if (started === 2) {
          bothStarted.resolve()
        }

        await bothStarted.promise
        const bytes = await readVariant(other)
        return bytes ? { data: bytes, mimeType: 'text/plain' } : null
      }
    const variants = defineUploadVariants({
      db,
      targets,
      target: targets.thumbs,
      variants: { a: readsOther('b'), b: readsOther('a') },
      onError,
    })

    expect(
      await Promise.all([
        variants.getVariant(source, 'a'),
        variants.getVariant(source, 'b'),
      ]),
    ).toEqual([null, null])
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'CONFIGURATION' }),
      expect.anything(),
    )
  })
})

describe('regenerateVariants', () => {
  beforeEach(resetTestDb)

  test('remakes every variant of one name and leaves the others alone', async () => {
    const targets = makeTargets()
    const one = await storeSource(targets, 'one')
    const two = await storeSource(targets, 'two')
    let version = 1
    const small = vi.fn<UploadVariantGenerator>(async ({ readSource }) => ({
      data: Buffer.from(`v${version}:${await readSource()}`),
      mimeType: 'text/plain',
    }))
    const large = vi.fn(upperCase('large'))
    const variants = defineUploadVariants({
      db,
      targets,
      target: targets.thumbs,
      variants: { small, large },
    })

    const oldSmall = await variants.getVariant(one, 'small')
    await variants.getVariant(two, 'small')
    const oldLarge = await variants.getVariant(one, 'large')
    expect(targets.thumbs.objects.size).toBe(3)

    version = 2
    const result = await variants.regenerateVariants('small')

    expect(result).toEqual({ deleted: 2, made: 2, failed: 0, errors: 0 })
    expect((await variants.readVariant(one, 'small'))?.data.toString()).toBe(
      'v2:one',
    )
    expect((await variants.readVariant(two, 'small'))?.data.toString()).toBe(
      'v2:two',
    )
    // The old file is gone from storage, the other variant untouched
    expect(targets.thumbs.objects.has(oldSmall!.storageKey!)).toBe(false)
    expect(targets.thumbs.objects.size).toBe(3)
    expect(await variants.findVariant(one, 'large')).toMatchObject({
      id: oldLarge?.id,
      updatedAt: oldLarge?.updatedAt,
    })
    expect(large).toHaveBeenCalledTimes(1)
    expect(small).toHaveBeenCalledTimes(4)
  })

  test('also retries remembered failures, and can leave remaking to the next read', async () => {
    const targets = makeTargets()
    const source = await storeSource(targets)
    let broken = true
    const variants = defineUploadVariants({
      db,
      targets,
      target: targets.thumbs,
      variants: {
        small: async (context) => {
          if (broken) {
            throw new Error('bug')
          }

          return upperCase('s')(context)
        },
      },
      onError: () => undefined,
    })

    expect(await variants.getVariant(source, 'small')).toBeNull()

    broken = false
    const result = await variants.regenerateVariants('small', {
      remake: false,
    })

    expect(result).toEqual({ deleted: 1, made: 0, failed: 0, errors: 0 })
    expect(await prisma.upload.count({ where: { sourceId: source.id } })).toBe(
      0,
    )
    expect(await variants.getVariant(source, 'small')).toMatchObject({
      status: 'completed',
    })
  })

  test('remakes a variant that was being made when it was deleted', async () => {
    const targets = makeTargets()
    const source = await storeSource(targets)
    let version = 1
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const variants = defineUploadVariants({
      db,
      targets,
      target: targets.thumbs,
      variants: {
        small: async ({ readSource }) => {
          const made = version

          if (made === 1) {
            started.resolve()
            await release.promise
          }

          return {
            data: Buffer.from(`v${made}:${await readSource()}`),
            mimeType: 'text/plain',
          }
        },
      },
    })

    const making = variants.getVariant(source, 'small')
    await started.promise

    version = 2
    const regenerating = variants.regenerateVariants('small')
    await vi.waitFor(async () => {
      expect(
        await prisma.upload.count({ where: { sourceId: source.id } }),
      ).toBe(0)
    })
    release.resolve()

    expect(await regenerating).toEqual({
      deleted: 1,
      made: 1,
      failed: 0,
      errors: 0,
    })
    expect(await making).toBeNull()
    expect((await variants.readVariant(source, 'small'))?.data.toString()).toBe(
      'v2:photo',
    )
    expect(targets.thumbs.objects.size).toBe(1)
  })
})

describe('deleting a source', () => {
  beforeEach(resetTestDb)

  test('deleteFile with targets deletes the variants and their stored files', async () => {
    const targets = makeTargets()
    const source = await storeSource(targets)
    const other = await storeSource(targets, 'other')
    const variants = defineUploadVariants({
      db,
      targets,
      target: targets.thumbs,
      variants: {
        small: upperCase('s'),
        large: upperCase('l'),
        inline: { generate: upperCase('i'), target: targets.inline },
      },
    })

    await variants.getVariant(source, 'small')
    await variants.getVariant(source, 'large')
    await variants.getVariant(source, 'inline')
    const kept = await variants.getVariant(other, 'small')
    expect(targets.thumbs.objects.size).toBe(3)

    await deleteFile(targets.files, { db, upload: source, targets })

    expect(await prisma.upload.findUnique({ where: { id: source.id } })).toBe(
      null,
    )
    expect(await prisma.upload.count({ where: { sourceId: source.id } })).toBe(
      0,
    )
    expect(targets.files.objects.has(source.storageKey!)).toBe(false)
    // Only the other source's variant is left in storage
    expect([...targets.thumbs.objects.keys()]).toEqual([kept?.storageKey])
  })

  test('deleteFile without targets refuses to delete a source that has variants', async () => {
    const targets = makeTargets()
    const source = await storeSource(targets)
    const variants = defineUploadVariants({
      db,
      targets,
      target: targets.thumbs,
      variants: { small: upperCase('s') },
    })

    await variants.getVariant(source, 'small')

    await expect(
      deleteFile(targets.files, { db, upload: source }),
    ).rejects.toMatchObject({
      code: 'HAS_VARIANTS',
      message: expect.stringContaining('Pass `targets` to deleteFile()'),
    })

    // Calling again with targets finishes the job
    await deleteFile(targets.files, { db, upload: source, targets })
    expect(await prisma.upload.count()).toBe(0)
    expect(targets.thumbs.objects.size).toBe(0)
  })

  test('deleteFile without targets passes on a reference that is not a variant', async () => {
    const targets = makeTargets()
    const source = await storeSource(targets)
    const referenced = Object.assign(new Error('foreign key'), {
      code: 'P2003',
    })
    vi.spyOn(prisma.upload, 'delete').mockRejectedValueOnce(referenced)

    await expect(
      deleteFile(targets.files, { db, upload: source }),
    ).rejects.toBe(referenced)
  })

  test('deleting a variant that is finished meanwhile deletes its file too', async () => {
    const targets = makeTargets()
    const source = await storeSource(targets)
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const variants = defineUploadVariants({
      db,
      targets,
      target: targets.thumbs,
      variants: {
        small: async (context) => {
          const bytes = await upperCase('s')(context)
          started.resolve()
          await release.promise
          return bytes
        },
      },
    })

    const making = variants.getVariant(source, 'small')
    await started.promise

    // The variant is saved after its pending row was read for deletion, and
    // before that row is deleted
    let raced = false
    const racing = withUpload({
      deleteMany: async (args) => {
        if (!raced) {
          raced = true
          release.resolve()
          await making
        }

        return withUpload({}).upload.deleteMany(args)
      },
    })

    expect(await deleteVariants(source, { db: racing, targets })).toBe(1)
    expect(await making).toMatchObject({ status: 'completed' })
    expect(targets.thumbs.objects.size).toBe(0)
    expect(await prisma.upload.count({ where: { sourceId: source.id } })).toBe(
      0,
    )
  })

  test('a variant finished after its source was deleted leaves no file behind', async () => {
    const targets = makeTargets()
    const source = await storeSource(targets)
    let release!: () => void
    const started = Promise.withResolvers<void>()
    const variants = defineUploadVariants({
      db,
      targets,
      target: targets.thumbs,
      variants: {
        small: async (context) => {
          const bytes = await upperCase('s')(context)
          started.resolve()
          await new Promise<void>((resolve) => {
            release = resolve
          })
          return bytes
        },
      },
    })

    const making = variants.getVariant(source, 'small')
    await started.promise

    await deleteFile(targets.files, { db, upload: source, targets })
    release()

    expect(await making).toBeNull()
    expect(targets.thumbs.objects.size).toBe(0)
    expect(await prisma.upload.count()).toBe(0)
  })
})
