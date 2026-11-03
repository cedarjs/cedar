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

  it('redacts every word of an unquoted path with spaces', () => {
    expect(
      redactErrorMessage('Cannot read /Users/Ada Lovelace/project/x.ts'),
    ).toEqual('Cannot read [path] [path]')
  })

  it('redacts IPv6 addresses and hosts with ports', () => {
    expect(redactErrorMessage('connect ECONNREFUSED 2001:db8:4::7')).toEqual(
      'connect ECONNREFUSED [host]',
    )
    expect(redactErrorMessage('connect ECONNREFUSED [::1]:5432')).toEqual(
      'connect ECONNREFUSED [host]',
    )
    expect(redactErrorMessage("Can't reach database at db.corp:5432")).toEqual(
      "Can't reach database at [host]",
    )
  })

  it('redacts other words containing @ or :', () => {
    expect(redactErrorMessage('No account for ada@acme.com')).toEqual(
      'No account for [redacted]',
    )
  })

  it('keeps words that describe the failure', () => {
    expect(
      redactErrorMessage("Cannot find module '@cedarjs/vite/client'"),
    ).toEqual("Cannot find module '@cedarjs/vite/client'")
    expect(
      redactErrorMessage('Cannot find package @acme/payroll@1.2.0'),
    ).toEqual('Cannot find package @acme/payroll@1.2.0')
    expect(redactErrorMessage('Failed to load node:fs/promises')).toEqual(
      'Failed to load [path]',
    )
    expect(redactErrorMessage('Failed to load node:sqlite')).toEqual(
      'Failed to load node:sqlite',
    )
    expect(redactErrorMessage('Invalid range workspace:* in npm:@a/b')).toEqual(
      'Invalid range workspace:* in npm:@a/b',
    )
    expect(
      redactErrorMessage('Requires Node >= 24.0.0, found 22.11.0.'),
    ).toEqual('Requires Node >= 24.0.0, found 22.11.0.')
    expect(redactErrorMessage('Error: timed out at 12:30:05 on C:')).toEqual(
      'Error: timed out at 12:30:05 on C:',
    )
  })

  it('only treats four groups of 1-3 digits as an IPv4 address', () => {
    expect(redactErrorMessage('Unsupported version 1.2.3.4567')).toEqual(
      'Unsupported version 1.2.3.4567',
    )
    expect(redactErrorMessage('Unsupported version 1.2.3.4.5')).toEqual(
      'Unsupported version 1.2.3.4.5',
    )
    expect(redactErrorMessage('Timed out reaching (10.0.3.7).')).toEqual(
      'Timed out reaching ([host]).',
    )
  })

  it('handles long runs of punctuation in linear time', () => {
    const message = ')'.repeat(200_000) + 'a/b'

    expect(redactErrorMessage(message)).toEqual('[path]')
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

  it('redacts the command line of a failed command', () => {
    expect(
      redactErrorMessage(
        "Command failed with exit code 1: git commit -m 'Payroll for Acme'",
      ),
    ).toBe('Command failed with exit code 1: [command]')
    expect(
      redactErrorMessage(
        'Command was killed with SIGTERM (Termination): yarn prisma migrate dev --name add-payroll',
      ),
    ).toBe('Command was killed with SIGTERM (Termination): [command]')
    expect(
      redactErrorMessage(
        'Command timed out after 5000 milliseconds: yarn install',
      ),
    ).toBe('Command timed out after 5000 milliseconds: [command]')
  })

  it('handles errors with a message that is not a string', () => {
    const error = new Error()
    Object.defineProperty(error, 'message', { value: 42 })
    expect(redactErrorMessage(error)).toBe('42')
  })

  it('handles non-Error values', () => {
    expect(redactErrorMessage(42)).toEqual('42')
    expect(redactErrorMessage('')).toEqual('Unknown error')
  })
})
