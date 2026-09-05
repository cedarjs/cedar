import { beforeEach, describe, expect, test } from 'vitest'

import { cleanupStaleUploads } from '../cleanupStaleUploads.js'
import { deleteFile } from '../deleteFile.js'
import { createDbProvider } from '../providers/db.js'
import { storeFile } from '../storeFile.js'
import { defineStorageTargets } from '../targets.js'

import { createMemoryProvider } from './helpers/memoryProvider.js'
import { db, prisma, resetTestDb } from './helpers/testDb.js'

const HOUR = 60 * 60 * 1000

function makeTargets() {
  return defineStorageTargets({
    files: createMemoryProvider(),
    thumbs: createDbProvider(),
  })
}

describe('storeFile', () => {
  beforeEach(resetTestDb)

  test('writes to object storage and records a completed row', async () => {
    const targets = makeTargets()

    const upload = await storeFile(targets.files, {
      db,
      filename: 'report.pdf',
      mimeType: 'application/pdf',
      data: Buffer.from('%PDF-1.4'),
      userId: 'user_1',
      organizationId: 'org_1',
    })

    expect(upload).toMatchObject({
      target: 'files',
      status: 'completed',
      filename: 'report.pdf',
      mimeType: 'application/pdf',
      size: 8n,
      data: null,
      userId: 'user_1',
      organizationId: 'org_1',
      tokenId: null,
    })
    expect(upload.storageKey).toMatch(/^[0-9a-f-]{36}\.pdf$/)
    expect(targets.files.objects.get(upload.storageKey!)?.toString()).toBe(
      '%PDF-1.4',
    )
  })

  test('stores bytes inline for DB targets and applies the 1 MB cap', async () => {
    const targets = makeTargets()

    const upload = await storeFile(targets.thumbs, {
      db,
      filename: 'dot.png',
      mimeType: 'image/png',
      data: Buffer.from([1, 2, 3]),
    })

    expect(upload.storageKey).toBeNull()
    expect(Buffer.from(upload.data!)).toEqual(Buffer.from([1, 2, 3]))
    expect(upload.userId).toBeNull()

    await expect(
      storeFile(targets.thumbs, {
        db,
        filename: 'big.bin',
        mimeType: 'application/octet-stream',
        data: Buffer.alloc(1024 * 1024 + 1),
      }),
    ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' })
  })

  test('honors an explicit maxSize for object storage', async () => {
    const targets = makeTargets()

    await expect(
      storeFile(targets.files, {
        db,
        filename: 'x.txt',
        mimeType: 'text/plain',
        data: Buffer.from('four'),
        maxSize: 3,
      }),
    ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' })

    expect(targets.files.objects.size).toBe(0)
    expect(await prisma.upload.count()).toBe(0)
  })
})

describe('deleteFile', () => {
  beforeEach(resetTestDb)

  test('deletes bytes then the row, and is idempotent', async () => {
    const targets = makeTargets()
    const upload = await storeFile(targets.files, {
      db,
      filename: 'x.txt',
      mimeType: 'text/plain',
      data: Buffer.from('x'),
    })

    await deleteFile(targets.files, { db, upload })

    expect(targets.files.objects.size).toBe(0)
    expect(
      await prisma.upload.findUnique({ where: { id: upload.id } }),
    ).toBeNull()

    await expect(
      deleteFile(targets.files, { db, upload }),
    ).resolves.toBeUndefined()
  })
})

describe('cleanupStaleUploads', () => {
  beforeEach(resetTestDb)

  test('claims old pending rows, deletes landed bytes, keeps tombstones', async () => {
    const targets = makeTargets()
    const old = new Date(Date.now() - 2 * HOUR)

    const stalePending = await prisma.upload.create({
      data: {
        target: 'files',
        status: 'pending',
        filename: 'a',
        mimeType: 'text/plain',
        size: 1n,
        storageKey: 'landed.txt',
        createdAt: old,
      },
    })
    targets.files.objects.set('landed.txt', Buffer.from('x'))

    const staleNoBytes = await prisma.upload.create({
      data: {
        target: 'files',
        status: 'pending',
        filename: 'b',
        mimeType: 'text/plain',
        size: 1n,
        storageKey: 'never-landed.txt',
        createdAt: old,
      },
    })

    const fresh = await prisma.upload.create({
      data: {
        target: 'files',
        status: 'pending',
        filename: 'c',
        mimeType: 'text/plain',
        size: 1n,
        storageKey: 'fresh.txt',
      },
    })

    const result = await cleanupStaleUploads({ db, targets })

    expect(result).toEqual({ claimed: 2, deleted: 1 })
    expect(targets.files.objects.has('landed.txt')).toBe(false)

    const rows = await prisma.upload.findMany({ orderBy: { filename: 'asc' } })
    expect(rows.map((r) => [r.id, r.status])).toEqual([
      [stalePending.id, 'failed'],
      [staleNoBytes.id, 'failed'],
      [fresh.id, 'pending'],
    ])
  })

  test('retries byte deletion for failed tombstones inside the retry window', async () => {
    const targets = makeTargets()

    await prisma.upload.create({
      data: {
        target: 'files',
        status: 'failed',
        filename: 'late',
        mimeType: 'text/plain',
        size: 1n,
        storageKey: 'late.txt',
      },
    })
    // Bytes that landed after the row was claimed
    targets.files.objects.set('late.txt', Buffer.from('x'))

    await prisma.upload.create({
      data: {
        target: 'files',
        status: 'failed',
        filename: 'ancient',
        mimeType: 'text/plain',
        size: 1n,
        storageKey: 'ancient.txt',
        createdAt: new Date(Date.now() - 48 * HOUR),
      },
    })
    targets.files.objects.set('ancient.txt', Buffer.from('x'))

    const result = await cleanupStaleUploads({ db, targets })

    expect(result).toEqual({ claimed: 0, deleted: 1 })
    expect(targets.files.objects.has('late.txt')).toBe(false)
    expect(targets.files.objects.has('ancient.txt')).toBe(true)
  })
})
