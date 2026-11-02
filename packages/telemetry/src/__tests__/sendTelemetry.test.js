import { describe, it, expect } from 'vitest'

import { sanitizeArgv } from '../sendTelemetry'

describe('sanitizeArgv', () => {
  it('keeps the command', () => {
    expect(sanitizeArgv(['node', 'cedar', 'build'])).toEqual('build')
  })

  it('keeps command names with dashes and colons', () => {
    expect(sanitizeArgv(['node', 'cedar', 'data-migrate', 'up'])).toEqual(
      'data-migrate',
    )
    expect(sanitizeArgv(['node', 'cedar', 'prisma:migrate'])).toEqual(
      'prisma:migrate',
    )
  })

  it('drops positional arguments after the command', () => {
    expect(
      sanitizeArgv(['node', 'cedar', 'g', 'page', 'Payroll', '/payroll']),
    ).toEqual('g')
    expect(
      sanitizeArgv(['node', 'cedar', 'exec', 'importCustomers', 'acme']),
    ).toEqual('exec')
    expect(sanitizeArgv(['node', 'cedar', 'build', 'acme-billing'])).toEqual(
      'build',
    )
  })

  it('keeps option names and drops their values', () => {
    expect(
      sanitizeArgv([
        'node',
        'cedar',
        'prisma',
        'migrate',
        'dev',
        '--name',
        'add-payroll',
      ]),
    ).toEqual('prisma --name')
    expect(
      sanitizeArgv([
        'node',
        'cedar',
        'serve',
        '--apiHost=http://10.0.3.7:8911',
        '--socket',
        '/run/acme.sock',
      ]),
    ).toEqual('serve --apiHost --socket')
  })

  it('keeps short options and boolean flags', () => {
    expect(
      sanitizeArgv(['node', 'cedar', 'g', 'page', 'Foo', '--force', '-t']),
    ).toEqual('g --force -t')
    expect(sanitizeArgv(['node', 'cedar', 'lint', '--no-fix'])).toEqual(
      'lint --no-fix',
    )
  })

  it('drops values attached to short options', () => {
    expect(
      sanitizeArgv([
        'node',
        'cedar',
        'data-migrate',
        'up',
        '-dtenant-acme/dist',
      ]),
    ).toEqual('data-migrate -d')
  })

  it('only keeps the command for exec, since its options belong to the script', () => {
    expect(
      sanitizeArgv([
        'node',
        'cedar',
        'exec',
        'seed',
        '--tenant-acme',
        '--silent',
      ]),
    ).toEqual('exec')
  })

  it('drops the command when an option comes first', () => {
    expect(
      sanitizeArgv(['node', 'cedar', '--cwd', '/Users/ada/acme', 'build']),
    ).toEqual('--cwd')
  })

  it('drops a first argument that is not a command name', () => {
    expect(sanitizeArgv(['node', 'cedar', '/Users/ada/acme'])).toEqual('')
    expect(sanitizeArgv(['node', 'cedar', 'ada@acme.com'])).toEqual('')
  })

  it('drops everything after --', () => {
    expect(
      sanitizeArgv(['node', 'cedar', 'exec', 'seed', '--', '--tenant', 'acme']),
    ).toEqual('exec')
  })

  it('returns an empty string when there are no arguments', () => {
    expect(sanitizeArgv(['node', 'cedar'])).toEqual('')
  })
})
