import { describe, it, expect } from 'vitest'

import { isRenderApiDeploy } from '../render.js'

describe('isRenderApiDeploy', () => {
  it.each([
    [['deploy', 'render', 'api']],
    [['--cwd', '../app', 'deploy', 'render', 'api']],
    [['deploy', 'render', 'api', '--no-prisma', '--dm', 'false']],
    [['deploy', 'render', '--no-prisma', 'api']],
    [['--telemetry', 'deploy', 'render', 'api']],
    [['--load-env-files', 'prod', 'staging', '--', 'deploy', 'render', 'api']],
  ])('returns true for %j', (args) => {
    expect(isRenderApiDeploy(args)).toBe(true)
  })

  it.each([
    [['serve', 'api']],
    [['build', 'api']],
    [['dev', 'api']],
    [['--cwd', 'api', 'serve', 'api']],
    [['deploy', 'render', 'web']],
    [['deploy', 'render', 'web', '--load-env-files', 'api']],
    [['deploy', 'render', 'web', '--cwd', 'api']],
    [['deploy', 'netlify']],
    [['deploy', 'api', 'render']],
    [['render', 'api']],
    [[]],
  ])('returns false for %j', (args) => {
    expect(isRenderApiDeploy(args)).toBe(false)
  })
})
