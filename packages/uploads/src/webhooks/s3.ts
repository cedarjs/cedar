import { UploadError } from '../errors.js'
import type { StorageTargets, UploadDatabase } from '../types.js'

import { assertTrustedSnsUrl, isSnsMessage, verifySnsMessage } from './sns.js'
import type { FetchCertificate } from './sns.js'

/** The parts of an S3 event notification record this handler reads. */
export interface S3EventRecord {
  eventName: string
  s3: {
    bucket: { name: string }
    object: { key: string; size?: number }
  }
}

export interface S3Event {
  Records: S3EventRecord[]
}

function isS3Event(value: unknown): value is S3Event {
  if (typeof value !== 'object' || value === null || !('Records' in value)) {
    return false
  }

  const records = value.Records

  return (
    Array.isArray(records) &&
    records.every(
      (r) =>
        typeof r === 'object' &&
        r !== null &&
        typeof r.eventName === 'string' &&
        typeof r.s3?.bucket?.name === 'string' &&
        typeof r.s3?.object?.key === 'string',
    )
  )
}

export type S3EventOutcome =
  'completed' | 'failed' | 'ignored' | 'not-found' | 'no-target'

function matchTarget(
  targets: StorageTargets,
  bucket: string,
  key: string,
): { name: string; storageKey: string } | null {
  let best: { name: string; keyPrefix: string } | null = null

  for (const [name, target] of Object.entries(targets)) {
    if (target.providerType !== 's3') {
      continue
    }

    const config = target.getConfig()
    const keyPrefix =
      typeof config.keyPrefix === 'string' ? config.keyPrefix : ''

    // Several targets may share a bucket with nested prefixes; the most
    // specific prefix is the one the object was written under
    if (
      config.bucket === bucket &&
      key.startsWith(keyPrefix) &&
      (!best || keyPrefix.length > best.keyPrefix.length)
    ) {
      best = { name, keyPrefix }
    }
  }

  return best
    ? { name: best.name, storageKey: key.slice(best.keyPrefix.length) }
    : null
}

/**
 * Settles the `pending` row for one `s3:ObjectCreated:*` record. The row is
 * matched on target plus storage key, the object's size is compared with
 * the size authorized at presign time, and the row is flipped `pending` to
 * `completed` (or claimed `failed` and the object deleted on a mismatch).
 * Both transitions are conditional, so a duplicate notification or a row
 * the cleanup job already claimed is left alone.
 */
export async function processS3EventRecord(
  record: S3EventRecord,
  { db, targets }: { db: UploadDatabase; targets: StorageTargets },
): Promise<S3EventOutcome> {
  if (!record.eventName.startsWith('ObjectCreated')) {
    return 'ignored'
  }

  // S3 URL-encodes keys in event notifications
  const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '))
  const match = matchTarget(targets, record.s3.bucket.name, key)

  if (!match) {
    return 'no-target'
  }

  const upload = await db.upload.findFirst({
    where: {
      target: match.name,
      storageKey: match.storageKey,
      status: 'pending',
    },
    omit: { data: true },
  })

  if (!upload) {
    return 'not-found'
  }

  const target = targets[match.name]
  const reportedSize = record.s3.object.size
  const actualSize =
    typeof reportedSize === 'number'
      ? reportedSize
      : await target.getObjectSize(match.storageKey)

  if (actualSize === null || BigInt(actualSize) !== upload.size) {
    const { count } = await db.upload.updateMany({
      where: { id: upload.id, status: 'pending' },
      data: { status: 'failed' },
    })

    if (count === 1) {
      await target.delete(match.storageKey)
    }

    return 'failed'
  }

  const { count } = await db.upload.updateMany({
    where: { id: upload.id, status: 'pending' },
    data: { status: 'completed', size: BigInt(actualSize) },
  })

  return count === 1 ? 'completed' : 'ignored'
}

export interface S3WebhookOptions {
  db: UploadDatabase
  targets: StorageTargets
  /** The trusted SNS topic. Messages from any other topic are rejected. */
  topicArn: string
  fetchCertificate?: FetchCertificate
  /** Used to confirm subscriptions. Defaults to global `fetch`. */
  fetch?: typeof fetch
}

export interface S3WebhookResult {
  type: 'Notification' | 'SubscriptionConfirmation' | 'UnsubscribeConfirmation'
  outcomes: S3EventOutcome[]
}

/**
 * Handles one SNS delivery carrying S3 event notifications: verifies the
 * signature and topic, confirms subscriptions, and settles every
 * `ObjectCreated` record. Throws an `UploadError` for anything that must be
 * rejected; the plugin turns that into the HTTP status.
 */
export async function handleS3Webhook(
  rawBody: string,
  options: S3WebhookOptions,
): Promise<S3WebhookResult> {
  let parsed: unknown

  try {
    parsed = JSON.parse(rawBody)
  } catch {
    throw new UploadError('INVALID_KEY', 'Webhook body is not JSON.')
  }

  if (!isSnsMessage(parsed)) {
    throw new UploadError('INVALID_KEY', 'Webhook body is not an SNS message.')
  }

  await verifySnsMessage(parsed, {
    topicArn: options.topicArn,
    fetchCertificate: options.fetchCertificate,
  })

  if (parsed.Type === 'SubscriptionConfirmation') {
    if (!parsed.SubscribeURL) {
      throw new UploadError('INVALID_KEY', 'Missing SubscribeURL.')
    }

    assertTrustedSnsUrl(parsed.SubscribeURL)
    const doFetch = options.fetch ?? fetch
    const res = await doFetch(parsed.SubscribeURL)

    if (!res.ok) {
      throw new UploadError(
        'CONFIGURATION',
        `Could not confirm the SNS subscription (HTTP ${res.status}).`,
      )
    }

    return { type: parsed.Type, outcomes: [] }
  }

  if (parsed.Type === 'UnsubscribeConfirmation') {
    return { type: parsed.Type, outcomes: [] }
  }

  let event: unknown

  try {
    event = JSON.parse(parsed.Message)
  } catch {
    throw new UploadError('INVALID_KEY', 'SNS message is not an S3 event.')
  }

  if (!isS3Event(event)) {
    // S3 sends a test event on subscription; it has no Records
    return { type: parsed.Type, outcomes: [] }
  }

  const outcomes: S3EventOutcome[] = []

  for (const record of event.Records) {
    outcomes.push(await processS3EventRecord(record, options))
  }

  return { type: parsed.Type, outcomes }
}
