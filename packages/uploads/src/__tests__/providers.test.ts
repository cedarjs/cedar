import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { UploadError } from '../errors.js'
import { createDbProvider } from '../providers/db.js'
import { createFsProvider } from '../providers/fs.js'
import { verifyServeToken } from '../serveToken.js'
import { defineStorageTargets, resolveTarget } from '../targets.js'

const secret = 'MY_VOICE_IS_MY_PASSPORT_VERIFY_ME'

describe('createFsProvider', () => {
  let uploadDir: string

  beforeEach(async () => {
    uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cedar-uploads-'))
  })

  afterEach(async () => {
    await fs.rm(uploadDir, { recursive: true, force: true })
  })

  test('writes, reads, sizes, streams, and deletes files', async () => {
    const provider = createFsProvider({
      uploadDir: path.join(uploadDir, 'nested'),
    })

    await provider.write('a.txt', Buffer.from('hello'), {
      contentType: 'text/plain',
    })

    expect((await provider.read('a.txt')).toString()).toBe('hello')
    expect(await provider.exists('a.txt')).toBe(true)
    expect(await provider.getObjectSize('a.txt')).toBe(5)

    const chunks: Buffer[] = []
    for await (const chunk of await provider.readStream!('a.txt')) {
      chunks.push(Buffer.from(chunk))
    }
    expect(Buffer.concat(chunks).toString()).toBe('hello')

    await provider.delete('a.txt')
    expect(await provider.exists('a.txt')).toBe(false)
    expect(await provider.getObjectSize('a.txt')).toBeNull()

    // Deleting a missing file is not an error
    await expect(provider.delete('a.txt')).resolves.toBeUndefined()
  })

  test('reports non-missing filesystem errors from exists()', async () => {
    // A directory where a file is expected makes access() fail with EISDIR
    // on read, but ENOTDIR when the key is treated as a path below a file
    await fs.writeFile(path.join(uploadDir, 'file.txt'), 'x')
    const provider = createFsProvider({
      uploadDir: path.join(uploadDir, 'file.txt'),
    })

    // `nested.txt` resolves below a regular file: ENOTDIR, a missing path
    expect(await provider.exists('nested.txt')).toBe(false)

    const unreadable = createFsProvider({ uploadDir })
    const spy = vi
      .spyOn(fs, 'access')
      .mockRejectedValueOnce(
        Object.assign(new Error('denied'), { code: 'EACCES' }),
      )
    await expect(unreadable.exists('a.txt')).rejects.toThrow('denied')
    spy.mockRestore()
  })

  test('rejects keys that could escape the upload directory', async () => {
    const provider = createFsProvider({ uploadDir })

    for (const key of ['../x', '/etc/passwd', 'a/b', '.hidden', 'a..b', '']) {
      await expect(
        provider.write(key, Buffer.from('x'), { contentType: 'text/plain' }),
      ).rejects.toMatchObject({ code: 'INVALID_KEY' })
    }
  })

  test('signs serve URLs that carry target, key, and disposition', async () => {
    const targets = defineStorageTargets({
      local: createFsProvider({
        uploadDir,
        serveBaseUrl: 'http://localhost:8911/',
        signSecret: secret,
      }),
    })

    const url = await targets.local.getSignedReadUrl('a.png', {
      disposition: 'inline',
    })

    expect(url).toMatch(
      /^http:\/\/localhost:8911\/upload\/serve\?token=[A-Za-z0-9._-]+$/,
    )

    const token = new URL(url).searchParams.get('token')
    expect(verifyServeToken(token, { secret })).toEqual({
      target: 'local',
      key: 'a.png',
      disposition: 'inline',
    })
  })

  test('defaults serve URLs to attachment disposition and honors routePrefix', async () => {
    const provider = createFsProvider({
      uploadDir,
      serveBaseUrl: 'https://api.example.com',
      signSecret: secret,
      routePrefix: '/files/',
    })
    provider.name = 'local'

    const url = await provider.getSignedReadUrl('a.png')
    expect(url.startsWith('https://api.example.com/files/serve?token=')).toBe(
      true,
    )

    const token = new URL(url).searchParams.get('token')
    expect(verifyServeToken(token, { secret }).disposition).toBe('attachment')
  })

  test('requires https for non-loopback serve origins', async () => {
    const insecure = createFsProvider({
      uploadDir,
      serveBaseUrl: 'http://api.example.com',
      signSecret: secret,
    })

    await expect(insecure.getSignedReadUrl('a.png')).rejects.toMatchObject({
      code: 'CONFIGURATION',
      message: expect.stringContaining('must use https'),
    })

    for (const origin of [
      'http://localhost:8911',
      'http://127.0.0.1:8911',
      'http://[::1]:8911',
      'https://api.example.com',
    ]) {
      const provider = createFsProvider({
        uploadDir,
        serveBaseUrl: origin,
        signSecret: secret,
      })
      provider.name = 'local'
      await expect(provider.getSignedReadUrl('a.png')).resolves.toContain(
        '/upload/serve?token=',
      )
    }

    const malformed = createFsProvider({
      uploadDir,
      serveBaseUrl: 'not a url',
      signSecret: secret,
    })
    await expect(malformed.getSignedReadUrl('a.png')).rejects.toMatchObject({
      code: 'CONFIGURATION',
    })
  })

  test('refuses to sign without a secret and base URL', async () => {
    const provider = createFsProvider({ uploadDir })

    await expect(provider.getSignedReadUrl('a.png')).rejects.toMatchObject({
      code: 'CONFIGURATION',
    })
  })

  test('does not support presigned uploads', async () => {
    const provider = createFsProvider({ uploadDir })

    await expect(
      provider.getPresignedUploadUrl('a.png', { contentType: 'image/png' }),
    ).rejects.toMatchObject({ code: 'PRESIGN_NOT_SUPPORTED' })
  })

  test('exposes its config', () => {
    expect(createFsProvider({ uploadDir }).getConfig()).toEqual({ uploadDir })
  })
})

describe('createDbProvider', () => {
  test('has no external storage', async () => {
    const provider = createDbProvider()
    provider.name = 'thumbs'

    expect(provider.providerType).toBe('db')
    expect(await provider.exists('x')).toBe(false)
    expect(await provider.getObjectSize('x')).toBeNull()
    await expect(provider.delete('x')).resolves.toBeUndefined()
    await expect(
      provider.write('x', Buffer.from(''), { contentType: 't' }),
    ).rejects.toBeInstanceOf(UploadError)
    await expect(provider.read('x')).rejects.toMatchObject({
      code: 'NOT_SUPPORTED',
    })
    await expect(provider.getSignedReadUrl('x')).rejects.toMatchObject({
      code: 'NOT_SUPPORTED',
    })
    await expect(
      provider.getPresignedUploadUrl('x', { contentType: 't' }),
    ).rejects.toMatchObject({ code: 'PRESIGN_NOT_SUPPORTED' })
    expect(provider.getConfig()).toEqual({})
  })
})

describe('defineStorageTargets / resolveTarget', () => {
  test('names providers after their keys', () => {
    const targets = defineStorageTargets({
      thumbs: createDbProvider(),
      local: createFsProvider({ uploadDir: '/tmp/x' }),
    })

    expect(targets.thumbs.name).toBe('thumbs')
    expect(targets.local.name).toBe('local')
    expect(resolveTarget(targets, 'local')).toBe(targets.local)
  })

  test('throws a listing error for unknown targets', () => {
    const targets = defineStorageTargets({ thumbs: createDbProvider() })

    expect(() => resolveTarget(targets, 'nope')).toThrow(
      "Unknown storage target 'nope'. Available targets: thumbs.",
    )
    // Inherited property names are not targets
    expect(() => resolveTarget(targets, 'toString')).toThrow(
      "Unknown storage target 'toString'.",
    )
  })
})
