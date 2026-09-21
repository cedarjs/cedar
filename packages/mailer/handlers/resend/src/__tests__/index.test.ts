import { afterEach, describe, expect, test, vi } from 'vitest'

import type { MailSendOptionsComplete } from '@cedarjs/mailer-core'

import { ResendMailHandler } from '../index.js'

const content = { html: '<p>Hello</p>', text: 'Hello' }

const sendOptions: MailSendOptionsComplete = {
  attachments: [],
  bcc: [],
  cc: [],
  from: 'from@example.com',
  headers: {},
  replyTo: undefined,
  subject: 'Hello',
  to: ['to@example.com'],
}

function stubResendApiResponse(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  })

  vi.stubGlobal('fetch', fetchMock)

  return fetchMock
}

describe('ResendMailHandler', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('returns the message ID when Resend accepts the email', async () => {
    const fetchMock = stubResendApiResponse(200, { id: 'message-id-123' })
    const handler = new ResendMailHandler({ apiKey: 're_test_key' })

    const result = await handler.send(content, sendOptions)

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(result.messageID).toBe('message-id-123')
    expect(result.handlerInformation).toEqual({
      data: { id: 'message-id-123' },
      error: null,
    })
  })

  test('rejects when Resend rejects the email', async () => {
    const apiError = {
      statusCode: 401,
      name: 'validation_error',
      message: 'API key is invalid',
    }
    stubResendApiResponse(401, apiError)
    const handler = new ResendMailHandler({ apiKey: 're_invalid_key' })

    const sendPromise = handler.send(content, sendOptions)

    await expect(sendPromise).rejects.toThrow(
      'Resend failed to send the email: validation_error: API key is invalid',
    )
    await expect(sendPromise).rejects.toMatchObject({ cause: apiError })
  })

  test('rejects when the request to Resend fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
    )
    const handler = new ResendMailHandler({ apiKey: 're_test_key' })

    await expect(handler.send(content, sendOptions)).rejects.toThrow(
      /^Resend failed to send the email: application_error: /,
    )
  })
})
