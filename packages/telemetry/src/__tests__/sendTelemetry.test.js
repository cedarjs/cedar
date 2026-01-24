import { describe, it, expect } from 'vitest'

import { sanitizeArgv } from '../sendTelemetry'

describe('sanitizeArgv', () => {
  it('ignores commands with no replacements', () => {
    const output = sanitizeArgv(['yarn', 'cedar', 'foo', 'arg'])

    expect(output).toEqual('foo arg')
  })

  it('replaces sensitive args in first position', () => {
    const output = sanitizeArgv(['yarn', 'cedar', 'g', 'page', 'Foo'])

    expect(output).toEqual('g page [name]')
  })

  it('replaces sensitive args in multiple positions', () => {
    const output = sanitizeArgv(['yarn', 'cedar', 'g', 'page', 'Foo', '/foo'])

    expect(output).toEqual('g page [name] [path]')
  })

  it('does not replace --flag args in numbered position', () => {
    const output = sanitizeArgv([
      'yarn',
      'cedar',
      'g',
      'page',
      'Foo',
      '--force',
    ])

    expect(output).toEqual('g page [name] --force')
  })

  it('replaces named --flag args', () => {
    const output = sanitizeArgv([
      'yarn',
      'cedar',
      'prisma',
      'migrate',
      'dev',
      '--name',
      'create-user',
    ])

    expect(output).toEqual('prisma migrate dev --name [name]')
  })
})
