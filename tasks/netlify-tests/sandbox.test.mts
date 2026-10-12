import { describe, expect, it } from 'vitest'

import { expectSandboxWorks } from '../sandbox-e2e/sandboxChecks.mts'

describe('Sandboxed child scripts on Netlify', () => {
  it('run with no network or environment, and sharp works', async () => {
    const res = await fetch(`${process.env.DEPLOY_URL}/.api/functions/sandbox`)
    const text = await res.text()

    expect({ status: res.status, text }).toMatchObject({ status: 200 })
    expectSandboxWorks(JSON.parse(text))
  })
})
