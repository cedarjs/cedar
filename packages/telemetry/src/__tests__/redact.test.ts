import { describe, expect, it } from 'vitest'

import { redactErrorMessage } from '../redact.js'

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
    expect(redactErrorMessage('')).toEqual('Unknown error')
  })
})
