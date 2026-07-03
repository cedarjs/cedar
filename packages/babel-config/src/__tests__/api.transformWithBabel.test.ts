import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { transformWithBabel } from '../api.js'

const FIXTURE_PATH = path.join(__dirname, '__fixtures__/cedar-app')
process.env.CEDAR_CWD = FIXTURE_PATH

describe('transformWithBabel', () => {
  it('uses provided sourceCode as the Babel input and sourcesContent', async () => {
    const input = [
      "import { createGraphQLHandler } from '@cedarjs/graphql-server'",
      '',
      'export const handler = createGraphQLHandler({',
      '  sdls,',
      '  services,',
      '})',
      '',
    ].join('\n')

    const result = await transformWithBabel(
      input,
      path.join(FIXTURE_PATH, 'api/src/functions/graphql.ts'),
      [],
      true,
    )

    expect(result?.code).toBeDefined()
    expect(result?.map).toBeDefined()
    expect(result?.map?.sourcesContent?.[0]).toBe(input)
  })
})
