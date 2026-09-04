import { describe, expect, it } from 'vitest'

import { getViteVersionMismatchMessage } from '../viteVersionCheck.js'

const frameworkVite = { version: '7.3.6', dir: '/project/node_modules/vite' }
const nestedVite = {
  version: '8.2.2',
  dir: '/project/node_modules/vitest/node_modules/vite',
}

describe('getViteVersionMismatchMessage', () => {
  it('returns undefined when the versions match', () => {
    const message = getViteVersionMismatchMessage({
      vitestVite: frameworkVite,
      frameworkVite,
    })

    expect(message).toBeUndefined()
  })

  it('returns undefined when either side is unresolved', () => {
    expect(
      getViteVersionMismatchMessage({ vitestVite: undefined, frameworkVite }),
    ).toBeUndefined()
    expect(
      getViteVersionMismatchMessage({
        vitestVite: nestedVite,
        frameworkVite: undefined,
      }),
    ).toBeUndefined()
  })

  it('names both versions, their paths, and the pin when they differ', () => {
    const message = getViteVersionMismatchMessage({
      vitestVite: nestedVite,
      frameworkVite,
    })

    expect(message).toContain('Vitest is using Vite 8.2.2')
    expect(message).toContain(nestedVite.dir)
    expect(message).toContain('built against Vite 7.3.6')
    expect(message).toContain(frameworkVite.dir)
    expect(message).toContain('override/resolution')
    expect(message).toContain('pins vite to 7.3.6')
  })
})
