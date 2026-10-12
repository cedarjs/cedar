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

  const { parentDns, probe, thumbnail } = body as {
    parentDns: string
    probe: { result: { results: Record<string, string>; env: string[] } }
    thumbnail: { result: unknown }
  }

  // The function itself has the network, so a refusal in the child means
  // the sandbox refused, not that the network is down
  expect(parentDns).toBe('resolved')

  // Only the sandbox's own refusals count: the permission model's
  // ERR_ACCESS_DENIED (Node 25+), or the no-network preload's error and its
  // missing fetch (Node 24). A timeout or ENETUNREACH would mean the child
  // did reach for the network
  const sandboxRefusal =
    /^refused: (ERR_ACCESS_DENIED|No network access in a sandboxed child)/
  expect(probe.result.results).toEqual({
    'tcp to a public host': expect.stringMatching(sandboxRefusal),
    'tcp to the metadata endpoint': expect.stringMatching(sandboxRefusal),
    fetch: expect.stringMatching(
      /^refused: (ERR_ACCESS_DENIED|fetch is not defined)/,
    ),
    dns: expect.stringMatching(sandboxRefusal),
    'read the server code': 'refused: ERR_ACCESS_DENIED',
  })
  expect(probe.result.env).toEqual([])

  expect(thumbnail.result).toEqual({
    format: 'webp',
    width: 8,
    height: 8,
    riff: 'RIFFWEBP',
  })
}
