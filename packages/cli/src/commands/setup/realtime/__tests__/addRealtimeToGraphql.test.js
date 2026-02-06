import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, it, expect } from 'vitest'

import { addRealtimeToGraphqlHandler } from '../addRealtimeToGraphql.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

describe('addRealtimeToGraphqlHandler', () => {
  const fixtures = [
    'aliased-import',
    'default-graphql-function',
    'evil-graphql-function',
    'function-graphql-function',
    'modified-graphql-function',
    'wrapper-function',
  ]

  for (const fixture of fixtures) {
    it(`matches snapshot for fixture "${fixture}"`, () => {
      const fixturePath = path.join(__dirname, fixture, 'graphql.js')
      const source = fs.readFileSync(fixturePath, 'utf-8')

      const result = addRealtimeToGraphqlHandler(source)

      // Ensure we attempted to modify and that something changed
      expect(result.skipped).not.toBe(true)
      expect(result.modified).toBe(true)

      // Snapshot the transformed code
      expect(result.code).toMatchSnapshot()

      // Idempotency: running the transform again should not modify the already-modified source
      const second = addRealtimeToGraphqlHandler(result.code)
      expect(second.modified).toBe(false)
      expect(second.code).toBe(result.code)
    })
  }

  it('skips when createGraphQLHandler import is missing', () => {
    const source = 'export const handler = () => ({})'
    const res = addRealtimeToGraphqlHandler(source)
    expect(res.skipped).toBe(true)
    expect(res).toMatchSnapshot()
  })
})
