import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

import { expect } from 'vitest'

import runTransform from '../testLib/runTransform.js'

import { formatCode } from './index.js'

const require = createRequire(import.meta.url)

export const matchInlineTransformSnapshot = async (
  transformName: string,
  fixtureCode: string,
  expectedCode: string,
  parser: 'ts' | 'tsx' | 'babel' = 'tsx',
) => {
  const tempDir = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), 'cedar-test-'),
  )
  const tempFilePath = path.join(
    tempDir,
    `tmpfile-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
  )
  fs.closeSync(fs.openSync(tempFilePath, 'w'))

  // Looks up the path of the caller
  const testPath = expect.getState().testPath

  if (!testPath) {
    throw new Error('Could not find test path')
  }

  const transformPath = require.resolve(
    path.join(testPath, '../../', transformName + '.ts'),
  )

  // Step 1: Write passed in code to a temp file
  fs.writeFileSync(tempFilePath, fixtureCode)

  // Step 2: Run transform against temp file
  await runTransform({
    transformPath,
    targetPaths: [tempFilePath],
    options: {
      verbose: 1,
    },
    parser,
  })

  // Step 3: Read modified file and snapshot
  const transformedContent = fs.readFileSync(tempFilePath, 'utf-8')

  expect(await formatCode(transformedContent)).toEqual(
    await formatCode(expectedCode),
  )

  // Not awaiting - it'll be cleaned up eventually. Also, I was getting errors
  // like these on Windows, so I'm just catching and ignoring them.
  // Error: EBUSY: resource busy or locked, rmdir 'C:\Users\RUNNER~1\AppData\Local\Temp\cedar-test-UhbKQX'
  fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {})
}
