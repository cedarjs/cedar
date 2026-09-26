import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, test, vi } from 'vitest'

import type { MailSendOptionsComplete } from '@cedarjs/mailer-core'

import { AhaSendMailHandler } from '../index.js'

const accountId = '8f7f2a8a-5a2b-4f7e-9c1d-1f0e2d3c4b5a'

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

function recipientResult(email: string, id: string | null, error?: string) {
  return {
    object: 'message',
    id,
    recipient: { email, name: '' },
    status: error ? 'error' : 'queued',
    error: error ?? null,
  }
}

function mockAhaSendApi(status: number, body: unknown) {
  return vi.fn<typeof fetch>(async () => {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  })
}

function firstRequest(fetchMock: ReturnType<typeof mockAhaSendApi>) {
  return new Request(...fetchMock.mock.calls[0])
}

describe('AhaSendMailHandler', () => {
  test('returns the message ID when AhaSend accepts the email', async () => {
    const response = {
      object: 'list',
      data: [recipientResult('to@example.com', '<message-id-123@ahasend>')],
    }
    const fetchMock = mockAhaSendApi(202, response)
    const handler = new AhaSendMailHandler({
      apiKey: 'aha-sk-test',
      accountId,
      fetch: fetchMock,
    })

    const result = await handler.send(content, sendOptions)

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(result.messageID).toBe('<message-id-123@ahasend>')
    expect(result.handlerInformation).toEqual(response)
  })

  test('sends one conversation message with all recipients', async () => {
    const fetchMock = mockAhaSendApi(202, {
      object: 'list',
      data: [recipientResult('to@example.com', '<message-id-123@ahasend>')],
    })
    const handler = new AhaSendMailHandler({
      apiKey: 'aha-sk-test',
      accountId,
      fetch: fetchMock,
    })

    await handler.send(
      content,
      {
        ...sendOptions,
        attachments: [
          { filename: 'notes.txt', content: 'Some notes' },
          { filename: 'invoice.pdf', content: Buffer.from('%PDF-1.7') },
        ],
        bcc: ['bcc@example.com'],
        cc: ['CC Person <cc@example.com>'],
        from: 'Cedar App <from@example.com>',
        replyTo: 'reply@example.com',
        to: ['to@example.com', 'Other <other@example.com>'],
      },
      { tags: ['welcome'], idempotencyKey: 'welcome-user-1' },
    )

    const request = firstRequest(fetchMock)
    expect(request.url).toBe(
      `https://api.ahasend.com/v2/accounts/${accountId}/messages/conversation`,
    )
    expect(request.headers.get('idempotency-key')).toBe('welcome-user-1')
    expect(await request.json()).toEqual({
      attachments: [
        {
          file_name: 'notes.txt',
          content_type: 'text/plain',
          data: 'Some notes',
        },
        {
          file_name: 'invoice.pdf',
          content_type: 'application/pdf',
          data: Buffer.from('%PDF-1.7').toString('base64'),
          base64: true,
        },
      ],
      bcc: [{ email: 'bcc@example.com' }],
      cc: [{ name: 'CC Person', email: 'cc@example.com' }],
      from: { name: 'Cedar App', email: 'from@example.com' },
      headers: {},
      reply_to: { email: 'reply@example.com' },
      subject: 'Hello',
      tags: ['welcome'],
      to: [
        { email: 'to@example.com' },
        { name: 'Other', email: 'other@example.com' },
      ],
      html_content: '<p>Hello</p>',
      text_content: 'Hello',
    })
  })

  test('resolves when AhaSend accepts only some recipients', async () => {
    const response = {
      object: 'list',
      data: [
        recipientResult('suppressed@example.com', null, 'Recipient suppressed'),
        recipientResult('to@example.com', '<message-id-123@ahasend>'),
      ],
    }
    const handler = new AhaSendMailHandler({
      apiKey: 'aha-sk-test',
      accountId,
      fetch: mockAhaSendApi(202, response),
    })

    const result = await handler.send(content, {
      ...sendOptions,
      to: ['suppressed@example.com', 'to@example.com'],
    })

    expect(result.messageID).toBe('<message-id-123@ahasend>')
    expect(result.handlerInformation).toEqual(response)
  })

  test('rejects when AhaSend accepts none of the recipients', async () => {
    const response = {
      object: 'list',
      data: [recipientResult('to@example.com', null, 'Recipient suppressed')],
    }
    const handler = new AhaSendMailHandler({
      apiKey: 'aha-sk-test',
      accountId,
      fetch: mockAhaSendApi(202, response),
    })

    const sendPromise = handler.send(content, sendOptions)

    await expect(sendPromise).rejects.toThrow(
      'AhaSend did not accept any recipient of the email: ' +
        'to@example.com: Recipient suppressed',
    )
    await expect(sendPromise).rejects.toMatchObject({ cause: response })
  })

  test('rejects when AhaSend rejects the request', async () => {
    const handler = new AhaSendMailHandler({
      apiKey: 'aha-sk-invalid',
      accountId,
      fetch: mockAhaSendApi(401, { message: 'Invalid API key' }),
    })

    const sendPromise = handler.send(content, sendOptions)

    await expect(sendPromise).rejects.toThrow(
      /^AhaSend failed to send the email: /,
    )
    await expect(sendPromise).rejects.toMatchObject({
      cause: { status: 401 },
    })
  })

  test('rejects when the request to AhaSend fails', async () => {
    const handler = new AhaSendMailHandler({
      apiKey: 'aha-sk-test',
      accountId,
      retry: { enabled: false },
      fetch: vi.fn<typeof fetch>(async () => {
        throw new TypeError('fetch failed')
      }),
    })

    await expect(handler.send(content, sendOptions)).rejects.toThrow(
      /^AhaSend failed to send the email: /,
    )
  })

  test('reads attachments from a local path or a URL', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'ahasend-'))
    const filePath = path.join(directory, 'report.csv')
    await writeFile(filePath, 'a,b\n1,2\n')

    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (String(input).startsWith('https://files.example.com/')) {
        return new Response('<svg/>')
      }

      return mockAhaSendApi(202, {
        object: 'list',
        data: [recipientResult('to@example.com', '<message-id-123@ahasend>')],
      })()
    })
    vi.stubGlobal('fetch', fetchMock)

    try {
      const handler = new AhaSendMailHandler({
        apiKey: 'aha-sk-test',
        accountId,
        fetch: fetchMock,
      })

      await handler.send(content, {
        ...sendOptions,
        attachments: [
          { path: filePath },
          { path: 'https://files.example.com/logo.svg?signature=abc' },
        ],
      })
    } finally {
      vi.unstubAllGlobals()
    }

    const request = new Request(...fetchMock.mock.calls[1])
    const body = await request.json()
    expect(body.attachments).toEqual([
      {
        file_name: 'report.csv',
        content_type: 'text/csv',
        data: Buffer.from('a,b\n1,2\n').toString('base64'),
        base64: true,
      },
      {
        file_name: 'logo.svg',
        content_type: 'image/svg+xml',
        data: Buffer.from('<svg/>').toString('base64'),
        base64: true,
      },
    ])
  })

  test('rejects an attachment without a filename', async () => {
    const fetchMock = mockAhaSendApi(202, { object: 'list', data: [] })
    const handler = new AhaSendMailHandler({
      apiKey: 'aha-sk-test',
      accountId,
      fetch: fetchMock,
    })

    await expect(
      handler.send(content, {
        ...sendOptions,
        attachments: [{ content: 'No name' }],
      }),
    ).rejects.toThrow('AhaSend requires a filename for every attachment')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
