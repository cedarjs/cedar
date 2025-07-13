import path from 'node:path'

import { beforeAll, describe, it, expect } from 'vitest'

import { runTransform } from '../../../../lib/runTransform.js'

describe('Db codemod', () => {
  beforeAll(async () => {
    // Was running into this issue
    // https://github.com/vitest-dev/vitest/discussions/6511
    //   Error: [vitest-worker]: Timeout calling "onTaskUpdate"
    // One workaround that was posted there was this:
    // TODO: Remove this workaround once the issue is fixed
    await new Promise((res) => setImmediate(res))
  })

  it('Handles the default db case', async () => {
    await matchTransformSnapshot('dbCodemod', 'defaultDb')
  })

  it('will throw an error if the db file has the old format', async () => {
    const transformResult = await runTransform({
      transformPath: path.join(__dirname, '../dbCodemod.ts'), // Use TS here!
      targetPaths: [
        path.join(__dirname, '../__testfixtures__/oldFormat.input.ts'),
      ],
    })

    expect(transformResult.error).toContain('ERR_OLD_FORMAT')
  })
})
