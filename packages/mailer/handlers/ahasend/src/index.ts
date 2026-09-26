import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { AhaSendClient } from '@ahasend/sdk'
import type {
  Address,
  AhaSendClientOptions,
  Attachment,
  CreateConversationMessageRequest,
  SendMessageResponse,
} from '@ahasend/sdk'

import type {
  MailAttachment,
  MailSendOptionsComplete,
  MailRenderedContent,
  MailResult,
} from '@cedarjs/mailer-core'
import { AbstractMailHandler } from '@cedarjs/mailer-core'

export type AhaSendMailHandlerOptions = Pick<
  CreateConversationMessageRequest,
  'tags' | 'sandbox' | 'sandbox_result' | 'tracking' | 'retention' | 'schedule'
> & {
  /**
   * Idempotency key for this send. AhaSend replays the stored result for
   * repeated requests with the same key for 24 hours. When omitted, the SDK
   * generates a key that is reused across its own retries of this request.
   */
  idempotencyKey?: string
}

const contentTypesByExtension: Record<string, string> = {
  '.csv': 'text/csv',
  '.gif': 'image/gif',
  '.htm': 'text/html',
  '.html': 'text/html',
  '.ics': 'text/calendar',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.webp': 'image/webp',
  '.xml': 'application/xml',
  '.zip': 'application/zip',
}

/**
 * Converts an address formatted by `@cedarjs/mailer-core`, either
 * `email@example.com` or `Name <email@example.com>`, into an AhaSend address
 */
function toAhaSendAddress(address: string): Address {
  const trimmed = address.trim()
  const open = trimmed.lastIndexOf('<')

  if (open === -1 || !trimmed.endsWith('>')) {
    return { email: trimmed }
  }

  const email = trimmed.slice(open + 1, -1).trim()
  let name = trimmed.slice(0, open).trim()

  if (name.length >= 2 && name.startsWith('"') && name.endsWith('"')) {
    name = name.slice(1, -1)
  }

  return name ? { name, email } : { email }
}

/**
 * AhaSend rejects empty address lists, so an empty list is left out of the
 * request
 */
function toAhaSendAddresses(addresses: string[]) {
  return addresses.length > 0 ? addresses.map(toAhaSendAddress) : undefined
}

async function toAhaSendAttachment(
  attachment: MailAttachment,
): Promise<Attachment> {
  const isUrl = /^https?:\/\//.test(attachment.path ?? '')
  const pathName =
    attachment.path && isUrl
      ? new URL(attachment.path).pathname
      : attachment.path
  const fileName =
    attachment.filename ?? (pathName ? path.basename(pathName) : undefined)

  if (!fileName) {
    throw new Error(
      'AhaSend requires a filename for every attachment. Set `filename` on ' +
        'attachments that are passed as `content`.',
    )
  }

  const contentType =
    contentTypesByExtension[path.extname(fileName).toLowerCase()] ??
    'application/octet-stream'

  if (typeof attachment.content === 'string') {
    return {
      file_name: fileName,
      content_type: contentType,
      data: attachment.content,
    }
  }

  let content = attachment.content

  if (!content && attachment.path) {
    content = isUrl
      ? await fetchAttachment(attachment.path)
      : await readFile(attachment.path)
  }

  if (!content) {
    throw new Error(
      `The attachment "${fileName}" has neither \`content\` nor \`path\`.`,
    )
  }

  return {
    file_name: fileName,
    content_type: contentType,
    data: content.toString('base64'),
    base64: true,
  }
}

async function fetchAttachment(url: string) {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(
      `Failed to fetch the attachment ${url}: ${response.status} ` +
        response.statusText,
    )
  }

  return Buffer.from(await response.arrayBuffer())
}

export class AhaSendMailHandler extends AbstractMailHandler {
  private client: AhaSendClient

  /**
   * Accepts every `AhaSendClient` option. `apiKey` and `accountId` are
   * required; the others, such as `retry` and `timeoutMs`, are optional.
   */
  constructor(options: AhaSendClientOptions) {
    super()
    this.client = new AhaSendClient(options)
  }

  async send(
    content: MailRenderedContent,
    sendOptions: MailSendOptionsComplete,
    handlerOptions?: AhaSendMailHandlerOptions,
  ): Promise<MailResult> {
    const { idempotencyKey, ...messageOptions } = handlerOptions ?? {}

    const attachments = await Promise.all(
      sendOptions.attachments.map(toAhaSendAttachment),
    )

    let response: SendMessageResponse

    try {
      // `sendConversation` sends a single message that all To, Cc and Bcc
      // recipients share, which is what a Cedar mail with several recipients
      // is. `messages.send` would instead send a separate message to each
      // recipient.
      response = await this.client.messages.sendConversation(
        {
          ...messageOptions,

          // Standard options
          attachments: attachments.length > 0 ? attachments : undefined,
          bcc: toAhaSendAddresses(sendOptions.bcc),
          cc: toAhaSendAddresses(sendOptions.cc),
          from: toAhaSendAddress(sendOptions.from),
          headers: sendOptions.headers,
          reply_to: sendOptions.replyTo
            ? toAhaSendAddress(sendOptions.replyTo)
            : undefined,
          subject: sendOptions.subject,
          to: sendOptions.to.map(toAhaSendAddress),

          // Content
          html_content: content.html,
          text_content: content.text,
        },
        { idempotencyKey },
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      throw new Error(`AhaSend failed to send the email: ${message}`, {
        cause: error,
      })
    }

    // AhaSend reports a status for each recipient. A send only fails when no
    // recipient was accepted. When some recipients are rejected, for example
    // because they are on the suppression list, the others have already been
    // queued, and failing the send would make callers retry and deliver the
    // email to them a second time. The per-recipient results are available
    // in `handlerInformation`.
    const accepted = response.data.filter((result) => result.status !== 'error')

    if (accepted.length === 0) {
      const reasons = response.data
        .map((result) => `${result.recipient.email}: ${result.error}`)
        .join('; ')

      throw new Error(
        `AhaSend did not accept any recipient of the email: ${reasons}`,
        { cause: response },
      )
    }

    return {
      messageID: accepted[0].id ?? undefined,
      handlerInformation: response,
    }
  }

  internal() {
    return {
      client: this.client,
    }
  }
}
