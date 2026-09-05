import { generateKeyPairSync, sign } from 'node:crypto'

import Fastify from 'fastify'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { cedarUploadsPlugin } from '../fastify/plugin.js'
import { defineStorageTargets } from '../targets.js'
import { handleS3Webhook, processS3EventRecord } from '../webhooks/s3.js'
import { snsStringToSign, verifySnsMessage } from '../webhooks/sns.js'
import type { SnsMessage } from '../webhooks/sns.js'

import { createMemoryProvider } from './helpers/memoryProvider.js'
import { db, prisma, resetTestDb } from './helpers/testDb.js'
import { SECRET } from './helpers/tokens.js'

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
})
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
const fetchCertificate = async () => publicPem

const TOPIC = 'arn:aws:sns:us-east-1:123456789012:uploads'

function snsMessage(
  overrides: Partial<SnsMessage> & { Message: string },
): SnsMessage {
  const message: SnsMessage = {
    Type: 'Notification',
    MessageId: 'msg-1',
    TopicArn: TOPIC,
    Timestamp: '2026-09-05T12:00:00.000Z',
    SignatureVersion: '2',
    Signature: '',
    SigningCertURL: 'https://sns.us-east-1.amazonaws.com/cert.pem',
    ...overrides,
  }

  message.Signature = sign(
    'RSA-SHA256',
    Buffer.from(snsStringToSign(message)),
    privateKey,
  ).toString('base64')

  return message
}

function s3Event(key: string, size: number, bucket = 'bucket') {
  return JSON.stringify({
    Records: [
      {
        eventName: 'ObjectCreated:Put',
        s3: { bucket: { name: bucket }, object: { key, size } },
      },
    ],
  })
}

describe('verifySnsMessage', () => {
  test('accepts a correctly signed message from the configured topic', async () => {
    const message = snsMessage({ Message: 'hi', Subject: 'S3 event' })

    await expect(
      verifySnsMessage(message, { topicArn: TOPIC, fetchCertificate }),
    ).resolves.toBeUndefined()
  })

  test('supports signature version 1', async () => {
    const message = snsMessage({ Message: 'hi', SignatureVersion: '1' })
    message.Signature = sign(
      'RSA-SHA1',
      Buffer.from(snsStringToSign(message)),
      privateKey,
    ).toString('base64')

    await expect(
      verifySnsMessage(message, { topicArn: TOPIC, fetchCertificate }),
    ).resolves.toBeUndefined()
  })

  test('rejects other topics, tampered messages, and untrusted cert URLs', async () => {
    const message = snsMessage({ Message: 'hi' })

    await expect(
      verifySnsMessage(message, {
        topicArn: 'arn:aws:sns:us-east-1:1:other',
        fetchCertificate,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    await expect(
      verifySnsMessage(
        { ...message, Message: 'tampered' },
        { topicArn: TOPIC, fetchCertificate },
      ),
    ).rejects.toMatchObject({ message: 'Invalid SNS signature.' })

    await expect(
      verifySnsMessage(
        { ...message, SigningCertURL: 'https://evil.example.com/cert.pem' },
        { topicArn: TOPIC, fetchCertificate },
      ),
    ).rejects.toMatchObject({ message: 'Untrusted SNS URL.' })

    await expect(
      verifySnsMessage(
        {
          ...message,
          SigningCertURL: 'http://sns.us-east-1.amazonaws.com/cert.pem',
        },
        { topicArn: TOPIC, fetchCertificate },
      ),
    ).rejects.toMatchObject({ message: 'Untrusted SNS URL.' })
  })
})

describe('processS3EventRecord', () => {
  beforeEach(resetTestDb)

  function makeTargets() {
    return defineStorageTargets({
      files: createMemoryProvider({ providerType: 's3', presign: true }),
    })
  }

  async function pending(size: bigint, storageKey = 'obj.png') {
    return prisma.upload.create({
      data: {
        target: 'files',
        status: 'pending',
        filename: 'a.png',
        mimeType: 'image/png',
        size,
        storageKey,
      },
    })
  }

  test('completes a pending row whose size matches', async () => {
    const targets = makeTargets()
    const row = await pending(3n)

    const outcome = await processS3EventRecord(
      {
        eventName: 'ObjectCreated:Put',
        s3: { bucket: { name: 'bucket' }, object: { key: 'obj.png', size: 3 } },
      },
      { db, targets },
    )

    expect(outcome).toBe('completed')
    expect(
      (await prisma.upload.findUniqueOrThrow({ where: { id: row.id } })).status,
    ).toBe('completed')
  })

  test('decodes URL-encoded keys and honors key prefixes', async () => {
    const targets = defineStorageTargets({
      files: Object.assign(createMemoryProvider({ providerType: 's3' }), {
        getConfig: () => ({ bucket: 'bucket', keyPrefix: 'avatars/' }),
      }),
    })
    const row = await pending(3n, 'my file.png')

    const outcome = await processS3EventRecord(
      {
        eventName: 'ObjectCreated:Put',
        s3: {
          bucket: { name: 'bucket' },
          object: { key: 'avatars/my+file.png', size: 3 },
        },
      },
      { db, targets },
    )

    expect(outcome).toBe('completed')
    expect(
      (await prisma.upload.findUniqueOrThrow({ where: { id: row.id } })).status,
    ).toBe('completed')
  })

  test('fails the row and deletes the object on a size mismatch', async () => {
    const targets = makeTargets()
    const row = await pending(3n)
    targets.files.objects.set('obj.png', Buffer.alloc(10))

    const outcome = await processS3EventRecord(
      {
        eventName: 'ObjectCreated:Put',
        s3: {
          bucket: { name: 'bucket' },
          object: { key: 'obj.png', size: 10 },
        },
      },
      { db, targets },
    )

    expect(outcome).toBe('failed')
    expect(targets.files.objects.has('obj.png')).toBe(false)
    expect(
      (await prisma.upload.findUniqueOrThrow({ where: { id: row.id } })).status,
    ).toBe('failed')
  })

  test('ignores non-create events, unknown buckets, and settled rows', async () => {
    const targets = makeTargets()
    await pending(3n)

    expect(
      await processS3EventRecord(
        {
          eventName: 'ObjectRemoved:Delete',
          s3: { bucket: { name: 'bucket' }, object: { key: 'obj.png' } },
        },
        { db, targets },
      ),
    ).toBe('ignored')

    expect(
      await processS3EventRecord(
        {
          eventName: 'ObjectCreated:Put',
          s3: {
            bucket: { name: 'other' },
            object: { key: 'obj.png', size: 3 },
          },
        },
        { db, targets },
      ),
    ).toBe('no-target')

    expect(
      await processS3EventRecord(
        {
          eventName: 'ObjectCreated:Put',
          s3: {
            bucket: { name: 'bucket' },
            object: { key: 'nope.png', size: 3 },
          },
        },
        { db, targets },
      ),
    ).toBe('not-found')
  })
})

describe('handleS3Webhook', () => {
  beforeEach(resetTestDb)

  const targets = defineStorageTargets({
    files: createMemoryProvider({ providerType: 's3' }),
  })

  test('confirms subscriptions through a trusted SubscribeURL', async () => {
    const doFetch = vi.fn<typeof fetch>(async () => new Response('ok'))
    const message = snsMessage({
      Type: 'SubscriptionConfirmation',
      Message: 'confirm',
      SubscribeURL:
        'https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription',
      Token: 'tok',
    })

    const result = await handleS3Webhook(JSON.stringify(message), {
      db,
      targets,
      topicArn: TOPIC,
      fetchCertificate,
      fetch: doFetch,
    })

    expect(result).toEqual({ type: 'SubscriptionConfirmation', outcomes: [] })
    expect(doFetch).toHaveBeenCalledWith(message.SubscribeURL)
  })

  test('settles every record in a notification', async () => {
    const row = await prisma.upload.create({
      data: {
        target: 'files',
        status: 'pending',
        filename: 'a.png',
        mimeType: 'image/png',
        size: 3n,
        storageKey: 'obj.png',
      },
    })

    const result = await handleS3Webhook(
      JSON.stringify(snsMessage({ Message: s3Event('obj.png', 3) })),
      { db, targets, topicArn: TOPIC, fetchCertificate },
    )

    expect(result).toEqual({ type: 'Notification', outcomes: ['completed'] })
    expect(
      (await prisma.upload.findUniqueOrThrow({ where: { id: row.id } })).status,
    ).toBe('completed')
  })

  test('rejects bodies that are not SNS messages', async () => {
    await expect(
      handleS3Webhook('not json', {
        db,
        targets,
        topicArn: TOPIC,
        fetchCertificate,
      }),
    ).rejects.toMatchObject({ message: 'Webhook body is not JSON.' })

    await expect(
      handleS3Webhook('{}', { db, targets, topicArn: TOPIC, fetchCertificate }),
    ).rejects.toMatchObject({ message: 'Webhook body is not an SNS message.' })
  })

  test('is exposed as POST {prefix}/webhook/s3 when configured', async () => {
    const app = Fastify()
    await app.register(cedarUploadsPlugin, {
      tokenSecret: SECRET,
      targets,
      db,
      s3Webhook: { topicArn: TOPIC, fetchCertificate },
    })

    const ok = await app.inject({
      method: 'POST',
      url: '/upload/webhook/s3',
      headers: { 'content-type': 'text/plain; charset=UTF-8' },
      payload: JSON.stringify(snsMessage({ Message: s3Event('ghost.png', 1) })),
    })
    expect(ok.statusCode).toBe(200)
    expect(ok.json()).toEqual({ type: 'Notification', outcomes: ['not-found'] })

    const forged = await app.inject({
      method: 'POST',
      url: '/upload/webhook/s3',
      headers: { 'content-type': 'text/plain; charset=UTF-8' },
      payload: JSON.stringify({
        ...snsMessage({ Message: 'x' }),
        Message: 'y',
      }),
    })
    expect(forged.statusCode).toBe(403)

    const disabled = Fastify()
    await disabled.register(cedarUploadsPlugin, {
      tokenSecret: SECRET,
      targets,
      db,
    })
    const missing = await disabled.inject({
      method: 'POST',
      url: '/upload/webhook/s3',
    })
    expect(missing.statusCode).toBe(404)

    await app.close()
    await disabled.close()
  })
})
