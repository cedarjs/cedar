import { expect } from 'vitest'

/**
 * What `/.api/functions/sandbox` (tasks/sandbox-e2e/api) must report on a
 * deployed platform: the children ran, the pure-JS one reached nothing it
 * shouldn't, and the sharp one made a thumbnail
 */
export function expectSandboxWorks(body: unknown) {
  expect(body).toMatchObject({
    probe: { ok: true },
    thumbnail: { ok: true },
  })

  const { probe, thumbnail } = body as {
    probe: { result: { results: Record<string, string>; env: string[] } }
    thumbnail: { result: unknown }
  }

  expect(Object.keys(probe.result.results)).toHaveLength(5)
  for (const [attempt, got] of Object.entries(probe.result.results)) {
    expect({ attempt, got }).toEqual({
      attempt,
      got: expect.stringMatching(/^refused: /),
    })
  }
  expect(probe.result.env).toEqual([])

  expect(thumbnail.result).toEqual({
    format: 'webp',
    width: 8,
    height: 8,
    riff: 'RIFFWEBP',
  })
}
