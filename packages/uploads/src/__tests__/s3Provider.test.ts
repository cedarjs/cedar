import { S3Client } from '@aws-sdk/client-s3'
import { describe, expect, test, vi } from 'vitest'

import { createS3Provider } from '../providers/s3.js'

function makeClient() {
  const client = new S3Client({
    region: 'us-east-1',
    credentials: { accessKeyId: 'AKIATEST', secretAccessKey: 'secret' },
  })
  const send = vi.spyOn(client, 'send')

  return { client, send }
}

function commandInput(send: ReturnType<typeof vi.spyOn>, call = 0) {
  const command = send.mock.calls[call][0] as { input: Record<string, unknown> }
  return command.input
}

describe('createS3Provider', () => {
  test('prefixes keys and passes content types on write', async () => {
    const { client, send } = makeClient()
    send.mockResolvedValue({} as never)
    const provider = createS3Provider({
      client,
      bucket: 'b',
      keyPrefix: 'avatars/',
    })

    await provider.write('a.png', Buffer.from('x'), {
      contentType: 'image/png',
    })

    expect(send.mock.calls[0][0].constructor.name).toBe('PutObjectCommand')
    expect(commandInput(send)).toMatchObject({
      Bucket: 'b',
      Key: 'avatars/a.png',
      ContentType: 'image/png',
    })
  })

  test('reads objects into a Buffer', async () => {
    const { client, send } = makeClient()
    send.mockResolvedValue({
      Body: { transformToByteArray: async () => new Uint8Array([104, 105]) },
    } as never)
    const provider = createS3Provider({ client, bucket: 'b' })

    expect((await provider.read('a.txt')).toString()).toBe('hi')
  })

  test('reports size, existence, and not-found from HeadObject', async () => {
    const { client, send } = makeClient()
    const provider = createS3Provider({ client, bucket: 'b' })

    send.mockResolvedValueOnce({ ContentLength: 12 } as never)
    expect(await provider.getObjectSize('a')).toBe(12)

    send.mockRejectedValueOnce(
      Object.assign(new Error('nf'), { name: 'NotFound' }),
    )
    expect(await provider.getObjectSize('a')).toBeNull()

    send.mockRejectedValueOnce(
      Object.assign(new Error('nf'), { $metadata: { httpStatusCode: 404 } }),
    )
    expect(await provider.exists('a')).toBe(false)

    send.mockRejectedValueOnce(new Error('boom'))
    await expect(provider.exists('a')).rejects.toThrow('boom')
  })

  test('signs read URLs with attachment disposition by default', async () => {
    const { client } = makeClient()
    const provider = createS3Provider({ client, bucket: 'b', keyPrefix: 'p/' })

    const url = new URL(
      await provider.getSignedReadUrl('a.png', { expiresIn: 60 }),
    )

    expect(url.hostname).toContain('amazonaws.com')
    expect(url.pathname.endsWith('/p/a.png')).toBe(true)
    expect(url.searchParams.get('response-content-disposition')).toBe(
      'attachment',
    )
    expect(url.searchParams.get('X-Amz-Expires')).toBe('60')

    const inline = new URL(
      await provider.getSignedReadUrl('a.png', { disposition: 'inline' }),
    )
    expect(inline.searchParams.get('response-content-disposition')).toBe(
      'inline',
    )
    expect(inline.searchParams.get('X-Amz-Expires')).toBe('3600')
  })

  test('presigns PUT uploads pinned to the content type', async () => {
    const { client } = makeClient()
    const provider = createS3Provider({
      client,
      bucket: 'b',
      uploadUrlExpiresIn: 120,
    })

    const result = await provider.getPresignedUploadUrl('a.png', {
      contentType: 'image/png',
    })

    expect(result.method).toBe('PUT')
    expect(result.headers).toEqual({ 'Content-Type': 'image/png' })

    const url = new URL(result.url)
    expect(url.pathname.endsWith('/a.png')).toBe(true)
    expect(url.searchParams.get('X-Amz-Expires')).toBe('120')
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toContain(
      'content-type',
    )
  })

  test('exposes bucket, region, and prefix', () => {
    const { client } = makeClient()
    const provider = createS3Provider({
      client,
      bucket: 'b',
      region: 'us-east-1',
      keyPrefix: 'p/',
    })

    expect(provider.providerType).toBe('s3')
    expect(provider.getConfig()).toEqual({
      bucket: 'b',
      region: 'us-east-1',
      keyPrefix: 'p/',
    })
  })
})
