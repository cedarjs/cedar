import { beforeEach, describe, expect, test, vi } from 'vitest'

import { defineUploadProfiles } from '../profiles.js'
import {
  confirmUpload,
  createPresignedUpload,
  issueUploadToken,
} from '../services.js'
import { defineStorageTargets } from '../targets.js'
import { verifyUploadToken } from '../uploadToken.js'

import { createMemoryProvider } from './helpers/memoryProvider.js'
import { db, prisma, resetTestDb } from './helpers/testDb.js'
import { basePayload, SECRET } from './helpers/tokens.js'

const profiles = defineUploadProfiles({
  avatar: {
    target: 'avatars',
    allowedMimeTypes: ['image/png'],
    maxFileSize: 1024,
    maxFiles: 2,
  },
})

function makeTargets() {
  return defineStorageTargets({
    avatars: createMemoryProvider({ providerType: 's3', presign: true }),
  })
}

const user = { id: 42 }

describe('issueUploadToken', () => {
  test('signs the profile constraints and binds the user', () => {
    const response = issueUploadToken({
      profiles,
      profile: 'avatar',
      secret: SECRET,
      currentUser: { id: 42, organizationId: 'org_1' },
    })

    expect(response).toMatchObject({
      allowedMimeTypes: ['image/png'],
      maxFileSize: 1024n,
      maxFiles: 2,
    })

    expect(verifyUploadToken(response.token, { secret: SECRET })).toMatchObject(
      {
        profile: 'avatar',
        target: 'avatars',
        sub: '42',
        organizationId: 'org_1',
      },
    )
  })

  test('requires a user and a known profile', () => {
    expect(() =>
      issueUploadToken({
        profiles,
        profile: 'avatar',
        secret: SECRET,
        currentUser: null,
      }),
    ).toThrow(expect.objectContaining({ code: 'UNAUTHENTICATED' }))

    expect(() =>
      issueUploadToken({
        profiles,
        profile: 'nope',
        secret: SECRET,
        currentUser: user,
      }),
    ).toThrow(expect.objectContaining({ code: 'UNKNOWN_PROFILE' }))
  })
})

describe('createPresignedUpload', () => {
  beforeEach(resetTestDb)

  const tokenPayload = { ...basePayload, jti: 'jti_1', target: 'avatars' }

  test('creates a pending row and returns the presigned URL', async () => {
    const targets = makeTargets()

    const result = await createPresignedUpload({
      db,
      targets,
      tokenPayload,
      input: { filename: 'me.png', contentType: 'image/png', size: '512' },
    })

    expect(result.method).toBe('PUT')
    expect(result.headers).toEqual({ 'Content-Type': 'image/png' })
    expect(result.url).toMatch(
      /^https:\/\/bucket\.example\.com\/[0-9a-f-]{36}\.png$/,
    )

    const row = await db.upload.findUniqueOrThrow({
      where: { id: result.uploadId },
    })
    expect(row).toMatchObject({
      target: 'avatars',
      status: 'pending',
      filename: 'me.png',
      mimeType: 'image/png',
      size: 512n,
      userId: 'user_1',
      tokenId: 'jti_1',
    })
    expect(result.url.endsWith(row.storageKey!)).toBe(true)
  })

  test('rejects disallowed types and oversized files before writing anything', async () => {
    const targets = makeTargets()

    await expect(
      createPresignedUpload({
        db,
        targets,
        tokenPayload,
        input: { filename: 'x.gif', contentType: 'image/gif', size: 1 },
      }),
    ).rejects.toMatchObject({ code: 'MIME_TYPE_NOT_ALLOWED' })

    await expect(
      createPresignedUpload({
        db,
        targets,
        tokenPayload,
        input: { filename: 'x.png', contentType: 'image/png', size: 1025n },
      }),
    ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' })

    expect(await prisma.upload.count()).toBe(0)
  })

  test('releases the token slot when the target cannot presign', async () => {
    const targets = defineStorageTargets({
      avatars: createMemoryProvider({ providerType: 'fs' }),
    })

    await expect(
      createPresignedUpload({
        db,
        targets,
        tokenPayload,
        input: { filename: 'x.png', contentType: 'image/png', size: 1 },
      }),
    ).rejects.toMatchObject({ code: 'PRESIGN_NOT_SUPPORTED' })

    expect(await prisma.upload.count()).toBe(0)
  })

  test('enforces maxFiles across requests sharing one token', async () => {
    const targets = makeTargets()
    const input = { filename: 'x.png', contentType: 'image/png', size: 1 }

    await createPresignedUpload({ db, targets, tokenPayload, input })
    await createPresignedUpload({ db, targets, tokenPayload, input })

    await expect(
      createPresignedUpload({ db, targets, tokenPayload, input }),
    ).rejects.toMatchObject({ code: 'TOO_MANY_FILES' })

    // A different token is unaffected
    await createPresignedUpload({
      db,
      targets,
      tokenPayload: { ...tokenPayload, jti: 'jti_2' },
      input,
    })

    expect(await prisma.upload.count()).toBe(3)
  })
})

describe('confirmUpload', () => {
  beforeEach(resetTestDb)

  async function pendingUpload(
    targets: ReturnType<typeof makeTargets>,
    size = 3,
  ) {
    const { uploadId } = await createPresignedUpload({
      db,
      targets,
      tokenPayload: {
        ...basePayload,
        jti: 'jti_1',
        target: 'avatars',
        sub: '42',
      },
      input: { filename: 'me.png', contentType: 'image/png', size },
    })

    return db.upload.findUniqueOrThrow({ where: { id: uploadId } })
  }

  test('completes a pending upload whose object matches the authorized size', async () => {
    const targets = makeTargets()
    const upload = await pendingUpload(targets)
    targets.avatars.objects.set(upload.storageKey!, Buffer.from('abc'))

    const confirmed = await confirmUpload({
      db,
      targets,
      uploadId: upload.id,
      currentUser: user,
    })

    expect(confirmed.status).toBe('completed')
  })

  test('is only allowed for the owner', async () => {
    const targets = makeTargets()
    const upload = await pendingUpload(targets)

    await expect(
      confirmUpload({
        db,
        targets,
        uploadId: upload.id,
        currentUser: { id: 7 },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    await expect(
      confirmUpload({ db, targets, uploadId: upload.id, currentUser: null }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  })

  test('rejects when the object never landed', async () => {
    const targets = makeTargets()
    const upload = await pendingUpload(targets)

    await expect(
      confirmUpload({ db, targets, uploadId: upload.id, currentUser: user }),
    ).rejects.toMatchObject({ code: 'NOT_IN_STORAGE' })
  })

  test('fails the row and deletes the object on a size mismatch', async () => {
    const targets = makeTargets()
    const upload = await pendingUpload(targets, 3)
    targets.avatars.objects.set(upload.storageKey!, Buffer.from('too long'))

    await expect(
      confirmUpload({ db, targets, uploadId: upload.id, currentUser: user }),
    ).rejects.toMatchObject({ code: 'SIZE_MISMATCH' })

    expect(targets.avatars.objects.has(upload.storageKey!)).toBe(false)
    expect(
      (await prisma.upload.findUniqueOrThrow({ where: { id: upload.id } }))
        .status,
    ).toBe('failed')
  })

  test('does not report success when cleanup claimed the row first', async () => {
    const targets = makeTargets()
    const upload = await pendingUpload(targets)
    targets.avatars.objects.set(upload.storageKey!, Buffer.from('abc'))

    // Simulate the cleanup job claiming the row between the read and the
    // conditional completion update
    const updateMany = vi.spyOn(prisma.upload, 'updateMany')
    updateMany.mockImplementationOnce(async () => {
      await prisma.upload.update({
        where: { id: upload.id },
        data: { status: 'failed' },
      })

      return { count: 0 }
    })

    await expect(
      confirmUpload({ db, targets, uploadId: upload.id, currentUser: user }),
    ).rejects.toMatchObject({ code: 'NOT_PENDING' })

    updateMany.mockRestore()
  })

  test('refuses settled rows and unknown ids', async () => {
    const targets = makeTargets()
    const upload = await pendingUpload(targets)
    await prisma.upload.update({
      where: { id: upload.id },
      data: { status: 'failed' },
    })

    await expect(
      confirmUpload({ db, targets, uploadId: upload.id, currentUser: user }),
    ).rejects.toMatchObject({ code: 'NOT_PENDING' })

    await expect(
      confirmUpload({ db, targets, uploadId: 'missing', currentUser: user }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
