import { createPublicKey, verify } from 'node:crypto'

import { UploadError } from '../errors.js'

/** An Amazon SNS HTTP(S) delivery, as posted to a subscribed endpoint. */
export interface SnsMessage {
  Type: 'Notification' | 'SubscriptionConfirmation' | 'UnsubscribeConfirmation'
  MessageId: string
  TopicArn: string
  Message: string
  Timestamp: string
  SignatureVersion: string
  Signature: string
  SigningCertURL: string
  Subject?: string
  SubscribeURL?: string
  Token?: string
}

const SIGNED_FIELDS: Record<SnsMessage['Type'], (keyof SnsMessage)[]> = {
  Notification: [
    'Message',
    'MessageId',
    'Subject',
    'Timestamp',
    'TopicArn',
    'Type',
  ],
  SubscriptionConfirmation: [
    'Message',
    'MessageId',
    'SubscribeURL',
    'Timestamp',
    'Token',
    'TopicArn',
    'Type',
  ],
  UnsubscribeConfirmation: [
    'Message',
    'MessageId',
    'SubscribeURL',
    'Timestamp',
    'Token',
    'TopicArn',
    'Type',
  ],
}

const SNS_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/

export function isSnsMessage(value: unknown): value is SnsMessage {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const m = value as Record<string, unknown>

  return (
    (m.Type === 'Notification' ||
      m.Type === 'SubscriptionConfirmation' ||
      m.Type === 'UnsubscribeConfirmation') &&
    typeof m.MessageId === 'string' &&
    typeof m.TopicArn === 'string' &&
    typeof m.Message === 'string' &&
    typeof m.Timestamp === 'string' &&
    typeof m.SignatureVersion === 'string' &&
    typeof m.Signature === 'string' &&
    typeof m.SigningCertURL === 'string'
  )
}

/** Only `https://sns.<region>.amazonaws.com/...` may supply a signing cert. */
export function assertTrustedSnsUrl(url: string) {
  let parsed: URL

  try {
    parsed = new URL(url)
  } catch {
    throw new UploadError('FORBIDDEN', 'Invalid SNS URL.')
  }

  if (parsed.protocol !== 'https:' || !SNS_HOST.test(parsed.hostname)) {
    throw new UploadError('FORBIDDEN', 'Untrusted SNS URL.')
  }
}

/** Builds the canonical string SNS signed, per the SNS signature spec. */
export function snsStringToSign(message: SnsMessage): string {
  const lines: string[] = []

  for (const field of SIGNED_FIELDS[message.Type]) {
    const value = message[field]

    if (typeof value === 'string') {
      lines.push(field, value)
    }
  }

  return lines.join('\n') + '\n'
}

export type FetchCertificate = (url: string) => Promise<string>

const certCache = new Map<string, Promise<string>>()

async function defaultFetchCertificate(url: string): Promise<string> {
  const cached = certCache.get(url)

  if (cached) {
    return cached
  }

  const pending = fetch(url).then(async (res) => {
    if (!res.ok) {
      throw new UploadError(
        'FORBIDDEN',
        `Could not fetch the SNS signing certificate (HTTP ${res.status}).`,
      )
    }

    return res.text()
  })

  pending.catch(() => certCache.delete(url))
  certCache.set(url, pending)

  return pending
}

export interface VerifySnsMessageOptions {
  /** The only topic whose messages are accepted. */
  topicArn: string
  fetchCertificate?: FetchCertificate
}

/**
 * Verifies an SNS message's signature against the certificate it names and
 * requires its `TopicArn` to exactly match the configured topic. A validly
 * signed message from any other topic is rejected.
 */
export async function verifySnsMessage(
  message: SnsMessage,
  {
    topicArn,
    fetchCertificate = defaultFetchCertificate,
  }: VerifySnsMessageOptions,
): Promise<void> {
  if (message.TopicArn !== topicArn) {
    throw new UploadError(
      'FORBIDDEN',
      `SNS message is from topic '${message.TopicArn}', not the configured topic.`,
    )
  }

  assertTrustedSnsUrl(message.SigningCertURL)

  const algorithm =
    message.SignatureVersion === '1'
      ? 'RSA-SHA1'
      : message.SignatureVersion === '2'
        ? 'RSA-SHA256'
        : null

  if (!algorithm) {
    throw new UploadError(
      'FORBIDDEN',
      `Unsupported SNS signature version '${message.SignatureVersion}'.`,
    )
  }

  const certificate = await fetchCertificate(message.SigningCertURL)

  let valid = false

  try {
    valid = verify(
      algorithm,
      Buffer.from(snsStringToSign(message), 'utf8'),
      createPublicKey(certificate),
      Buffer.from(message.Signature, 'base64'),
    )
  } catch (e) {
    throw new UploadError('FORBIDDEN', 'Could not verify SNS signature.', e)
  }

  if (!valid) {
    throw new UploadError('FORBIDDEN', 'Invalid SNS signature.')
  }
}
