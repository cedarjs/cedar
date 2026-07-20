import { describe, it, expect, vi, beforeEach } from 'vitest'

import { runPrePushTasks } from '../tasks.mts'

const callOrder: string[] = []
let resolveBuild: () => void
let buildDeferred: Promise<void>
let buildShouldFail: boolean

vi.mock('../utils.mts', () => ({
  isOnReleaseBranch: () => false,
  execAsync: vi.fn((command: string, args: string[]) => {
    const label = `${command} ${args.join(' ')}`.trim()
    callOrder.push(label)

    if (command === 'yarn' && args[0] === 'build') {
      if (buildShouldFail) {
        const err = new Error('[git-hooks] command exited with status 1')
        ;(err as Error & { exitCode: number }).exitCode = 1
        return buildDeferred.then(() => Promise.reject(err))
      }
      return buildDeferred
    }

    return Promise.resolve()
  }),
}))

describe('runPrePushTasks', () => {
  beforeEach(() => {
    callOrder.length = 0
    buildShouldFail = false
    buildDeferred = new Promise<void>((resolve) => {
      resolveBuild = resolve
    })
  })

  it('does not start `yarn lint` until `yarn build` has finished, while everything else starts immediately', async () => {
    const runPromise = runPrePushTasks()

    // Flush microtasks so every task that *doesn't* wait on build has a
    // chance to be invoked
    await new Promise((resolve) => setImmediate(resolve))

    expect(callOrder).toContain('yarn build')
    expect(callOrder).toContain('yarn prettier --check .')
    expect(callOrder).toContain('yarn check')
    expect(callOrder.some((c) => c.includes('check-no-only.mts'))).toBe(true)

    // The bug this test guards against: lint racing build for packages'
    // compiled dist/ output (e.g. lint:templates requiring
    // @cedarjs/babel-config's dist before build has written it)
    expect(callOrder).not.toContain('yarn lint')

    resolveBuild()
    await runPromise

    expect(callOrder).toContain('yarn lint')
    // lint must be recorded after build, since it's only invoked once
    // build's promise resolves
    expect(callOrder.indexOf('yarn lint')).toBeGreaterThan(
      callOrder.indexOf('yarn build'),
    )
  })

  it('propagates a build failure as the result, without running lint', async () => {
    buildShouldFail = true

    const runPromise = runPrePushTasks()
    resolveBuild()

    const exitCode = await runPromise

    expect(exitCode).toEqual(1)
    expect(callOrder).not.toContain('yarn lint')
  })
})
