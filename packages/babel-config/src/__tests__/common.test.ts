import { vol } from 'memfs'

import { getCommonPlugins } from '../common.js'

const cedarProjectPath = '/cedar-app'
process.env.CEDAR_CWD = cedarProjectPath

afterEach(() => {
  vol.reset()
})

test("common plugins haven't changed unintentionally", () => {
  const commonPlugins = getCommonPlugins()

  expect(commonPlugins).toMatchInlineSnapshot(`[]`)
})
