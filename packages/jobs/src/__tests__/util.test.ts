import { hostname } from 'node:os'

import { describe, expect, it } from 'vitest'

import { lockName } from '../util.js'

describe('lockName', () => {
  it('is the given process name plus the host and process id', () => {
    const name = lockName('cedar-jobs-worker.default-email.1')

    expect(name).toEqual(
      `cedar-jobs-worker.default-email.1 host:${hostname()} pid:${process.pid}`,
    )
  })

  it('is unique to the given process name', () => {
    expect(lockName('worker-a')).not.toEqual(lockName('worker-b'))
  })
})
