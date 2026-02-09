import path from 'path'

import { beforeAll, afterAll, test, expect } from 'vitest'

import { loadAndValidateSdls } from '../validateSchema.js'

const FIXTURE_PATH = path.resolve(
  __dirname,
  '../../../../__fixtures__/example-todo-main',
)

beforeAll(() => {
  process.env.CEDAR_CWD = FIXTURE_PATH
})
afterAll(() => {
  delete process.env.CEDAR_CWD
})

test('Validates correctly on all platforms', async () => {
  await expect(loadAndValidateSdls()).resolves.not.toThrowError()
})
