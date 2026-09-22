import { describe, expect, it, vi } from 'vitest'

vi.mock('@cedarjs/project-config', () => ({
  getParsedScalars: () => ({ DateTime: 'Date' }),
  getPaths: () => ({
    generated: { schema: '/does/not/exist/schema.graphql' },
  }),
}))

describe('loadParsedScalarsCacheConfig with no generated schema', () => {
  it('returns undefined instead of throwing, so a project can start before its first generate', async () => {
    const { loadParsedScalarsCacheConfig } =
      await import('../generate/parsedScalars.js')

    expect(loadParsedScalarsCacheConfig()).toBeUndefined()
  })
})
