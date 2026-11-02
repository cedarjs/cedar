import type { Span } from '@opentelemetry/api'
import { SpanStatusCode } from '@opentelemetry/api'
import { describe, expect, it, vi } from 'vitest'

import { recordTelemetryError } from '../index.js'
import { redactError, redactErrorMessage } from '../redact.js'

describe('redactErrorMessage', () => {
  it.each([
    [
      "ENOENT: no such file or directory, open '/Users/ada/clients/acme/api/src/x.ts'",
      "ENOENT: no such file or directory, open '[path]'",
    ],
    [
      'Cannot find module C:\\Users\\jsmith\\app\\web\\src\\App.tsx',
      'Cannot find module [path]',
    ],
    ['Missing ./api/src/lib/db.ts', 'Missing [path]'],
    ['Missing ../shared/config.json', 'Missing [path]'],
    ['Missing ~/projects/acme/.env', 'Missing [path]'],
    [
      'Could not connect to postgres://admin:hunter2@db.corp:5432/payroll',
      'Could not connect to [url]',
    ],
    ['https://api.example.com/v1 returned 500', '[url] returned 500'],
    ['User cancelled install', 'User cancelled install'],
  ])('redacts %j', (input, expected) => {
    expect(redactErrorMessage(input)).toEqual(expected)
    expect(redactErrorMessage(new Error(input))).toEqual(expected)
  })

  it('only keeps the first line', () => {
    expect(
      redactErrorMessage(
        'Build failed\n    at build (/Users/ada/clients/acme/web/vite.config.ts:12:3)',
      ),
    ).toEqual('Build failed')
  })

  it('redacts whole quoted paths, including spaces', () => {
    expect(
      redactErrorMessage(
        "ENOENT: open 'C:\\Users\\Ada Lovelace\\clients\\acme\\db.sqlite'",
      ),
    ).toEqual("ENOENT: open '[path]'")
    expect(
      redactErrorMessage('Cannot read "/Users/Ada Lovelace/My Projects/x.ts"'),
    ).toEqual('Cannot read "[path]"')
    expect(redactErrorMessage("Unexpected token '}' in JSON")).toEqual(
      "Unexpected token '}' in JSON",
    )
  })

  it('redacts UNC paths', () => {
    expect(
      redactErrorMessage('Cannot find \\\\fileserver\\share\\acme\\app'),
    ).toEqual('Cannot find [path]')
  })

  it('redacts quoted strings without a closing quote in linear time', () => {
    const message = "'" + '/a'.repeat(100_000)

    expect(redactErrorMessage(message)).toEqual("'[path]")
  })

  it('redacts hosts in DNS errors and IPv4 addresses', () => {
    expect(
      redactErrorMessage('getaddrinfo ENOTFOUND db.acme-internal.corp'),
    ).toEqual('getaddrinfo ENOTFOUND [host]')
    expect(redactErrorMessage('getaddrinfo EAI_AGAIN api.corp')).toEqual(
      'getaddrinfo EAI_AGAIN [host]',
    )
    expect(redactErrorMessage('connect ECONNREFUSED 10.0.3.7:5432')).toEqual(
      'connect ECONNREFUSED [host]',
    )
    expect(redactErrorMessage('Timed out reaching 192.168.1.20')).toEqual(
      'Timed out reaching [host]',
    )
  })

  it('handles long runs of scheme characters in linear time', () => {
    const message = 'A'.repeat(200_000)

    expect(redactErrorMessage(message)).toEqual(message)
  })

  it('handles non-Error values', () => {
    expect(redactErrorMessage(42)).toEqual('42')
    expect(redactErrorMessage(undefined)).toEqual('undefined')
    expect(redactErrorMessage({ toString: () => 'open /etc/hosts' })).toEqual(
      'open [path]',
    )
  })

  it('falls back to a generic message for an empty first line', () => {
    expect(redactErrorMessage('')).toEqual('Unknown error')
    expect(redactErrorMessage('\nsecond line')).toEqual('Unknown error')
  })
})

describe('redactError', () => {
  it('keeps the name, redacts the message and drops the original stack', () => {
    const original = new TypeError(
      "Cannot read '/Users/ada/clients/acme/api/src/x.ts'",
    )

    const redacted = redactError(original)

    expect(redacted).not.toBe(original)
    expect(redacted.name).toEqual('TypeError')
    expect(redacted.message).toEqual("Cannot read '[path]'")
    expect(redacted.stack).toEqual("TypeError: Cannot read '[path]'")
  })
})

describe('recordTelemetryError', () => {
  it('only puts redacted values on the span', () => {
    const span = {
      setStatus: vi.fn(),
      recordException: vi.fn(),
    }
    const error = new Error(
      'Could not connect to postgres://admin:hunter2@db.corp:5432/payroll\n' +
        '    at connect (/Users/ada/clients/acme/api/src/lib/db.ts:1:1)',
    )

    // Only the two methods used by recordTelemetryError are needed
    recordTelemetryError(error, span as unknown as Span)

    expect(span.setStatus).toHaveBeenCalledWith({
      code: SpanStatusCode.ERROR,
      message: 'Could not connect to [url]',
    })

    const recorded = span.recordException.mock.calls[0][0]
    expect(recorded).not.toBe(error)
    expect(recorded.message).toEqual('Could not connect to [url]')
    expect(recorded.stack).not.toContain('/Users/ada')
  })
})
