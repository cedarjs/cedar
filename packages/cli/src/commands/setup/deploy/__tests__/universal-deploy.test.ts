import { vi, describe, it, expect, beforeEach } from 'vitest'

import {
  addPluginToConfig,
  mergeImport,
} from '../providers/universalDeployHandler.js'

describe('mergeImport', () => {
  it('adds UD plugin to a single-line named import', () => {
    const input = `import dns from 'dns'
import { defineConfig } from 'vite'
import { cedar } from '@cedarjs/vite'

dns.setDefaultResultOrder('verbatim')

export default defineConfig({
  plugins: [cedar()],
})`
    const result = mergeImport(input)
    expect(result).toContain(
      `import { cedar, cedarUniversalDeployPlugin } from '@cedarjs/vite'`,
    )
  })

  it('adds UD plugin to a default import', () => {
    const input = `import dns from 'dns'
import { defineConfig } from 'vite'
import redwood from '@cedarjs/vite'

export default defineConfig({
  plugins: [redwood()],
})`
    const result = mergeImport(input)
    expect(result).toContain(
      `import redwood, { cedarUniversalDeployPlugin } from '@cedarjs/vite'`,
    )
  })

  it('adds UD plugin to a multiline named import', () => {
    const input = `import dns from 'dns'
import { defineConfig } from 'vite'
import {
  cedar,
} from '@cedarjs/vite'

export default defineConfig({
  plugins: [cedar()],
})`
    const result = mergeImport(input)
    expect(result).toContain('cedarUniversalDeployPlugin,')
    // The multiline import should remain multiline
    expect(result).not.toContain('cedar, cedarUniversalDeployPlugin')
  })

  it('does nothing if UD plugin is already imported', () => {
    const input = `import dns from 'dns'
import { defineConfig } from 'vite'
import { cedar, cedarUniversalDeployPlugin } from '@cedarjs/vite'

export default defineConfig({
  plugins: [cedar(), cedarUniversalDeployPlugin()],
})`
    const result = mergeImport(input)
    expect(result).toBe(input)
  })

  it('throws when no import from @cedarjs/vite exists', () => {
    const input = `import dns from 'dns'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [cedar()],
})`
    expect(() => mergeImport(input)).toThrow(
      'No import from @cedarjs/vite found',
    )
  })

  it('throws when no imports exist at all', () => {
    const input = `export default defineConfig({
  plugins: [cedar()],
})`
    expect(() => mergeImport(input)).toThrow(
      'No import from @cedarjs/vite found',
    )
  })

  it('handles imports with a trailing semicolon', () => {
    const input = `import { cedar } from '@cedarjs/vite';`
    const result = mergeImport(input)
    expect(result).toBe(
      `import { cedar, cedarUniversalDeployPlugin } from '@cedarjs/vite';`,
    )
  })

  it('handles an import with only cedarUniversalDeployPlugin in single line', () => {
    const input = `import { cedar, cedarUniversalDeployPlugin } from '@cedarjs/vite'`
    const result = mergeImport(input)
    expect(result).toBe(input)
  })
})

describe('addPluginToConfig', () => {
  it('adds to a single-line plugins array with a trailing comma', () => {
    const input = `export default defineConfig({
  plugins: [cedar()],
})`
    const result = addPluginToConfig(input)
    expect(result).toContain('cedarUniversalDeployPlugin()')
    expect(result).toBe(`export default defineConfig({
  plugins: [cedar(), cedarUniversalDeployPlugin()],
})`)
  })

  it('adds to an inline plugins array without a trailing comma on the line', () => {
    const input = `export default defineConfig({
  plugins: [cedar()]
})`
    const result = addPluginToConfig(input)
    expect(result).toContain('cedarUniversalDeployPlugin()')
    expect(result).toBe(`export default defineConfig({
  plugins: [cedar(), cedarUniversalDeployPlugin()],
})`)
  })

  it('adds to a multi-line plugins array', () => {
    const input = `export default defineConfig({
  plugins: [
    cedar(),
  ],
})`
    const result = addPluginToConfig(input)
    expect(result).toBe(`export default defineConfig({
  plugins: [
    cedar(),
    cedarUniversalDeployPlugin(),
  ],
})`)
  })

  it('adds to a multi-line plugins array with no trailing comma on entries', () => {
    const input = `export default defineConfig({
  plugins: [
    cedar({ mode })
  ]
})`
    const result = addPluginToConfig(input)
    expect(result).toContain('cedarUniversalDeployPlugin()')
    expect(result).toBe(`export default defineConfig({
  plugins: [
    cedar({ mode }),
    cedarUniversalDeployPlugin(),
  ]
})`)
  })

  it('adds to an empty plugins array (inline)', () => {
    const input = `export default defineConfig({
  plugins: [],
})`
    const result = addPluginToConfig(input)
    expect(result).toBe(`export default defineConfig({
  plugins: [cedarUniversalDeployPlugin()],
})`)
  })

  it('adds to an empty plugins array (multi-line)', () => {
    const input = `export default defineConfig({
  plugins: [
  ],
})`
    const result = addPluginToConfig(input)
    expect(result).toBe(`export default defineConfig({
  plugins: [
    cedarUniversalDeployPlugin(),
  ],
})`)
  })

  it('returns the content unchanged when no plugins array is found', () => {
    const input = `export default defineConfig({})`
    const result = addPluginToConfig(input)
    expect(result).toBe(input)
  })

  it('handles a config function wrapper', () => {
    const input = `export default defineConfig(({ mode }) => ({
  plugins: [cedar({ mode })],
  test: {
    environment: 'jsdom',
  },
}))`
    const result = addPluginToConfig(input)
    expect(result).toBe(`export default defineConfig(({ mode }) => ({
  plugins: [cedar({ mode }), cedarUniversalDeployPlugin()],
  test: {
    environment: 'jsdom',
  },
}))`)
  })
})

describe('handler integration', () => {
  beforeEach(() => {
    process.env.CEDAR_CWD = '/cedar-app'
    vi.resetModules()
  })

  it('adds cedarUniversalDeployPlugin to a vite.config.ts with named import', async () => {
    const memfs = await import('memfs')
    vi.doMock('node:fs', async () => ({
      ...memfs.fs,
      default: memfs.fs,
    }))

    vi.doMock('@cedarjs/project-config', () => ({
      getPaths: () => ({
        base: '/cedar-app',
        web: { base: '/cedar-app/web' },
        api: { base: '/cedar-app/api' },
      }),
      getConfigPath: () => '/cedar-app/cedar.toml',
    }))

    vi.doMock('@cedarjs/cli-helpers', async () => {
      const cliHelpers = await vi.importActual('@cedarjs/cli-helpers')
      return {
        getPaths: () => ({
          base: '/cedar-app',
          web: { base: '/cedar-app/web' },
          api: { base: '/cedar-app/api' },
        }),
        isTypeScriptProject: () => true,
        recordTelemetryAttributes: vi.fn(),
        colors: cliHelpers.colors,
      }
    })

    vi.doMock('@cedarjs/telemetry', () => ({ errorTelemetry: vi.fn() }))

    vi.doMock('../../../../lib/index.js', () => ({
      printSetupNotes: () => ({
        title: 'One more thing...',
        task: vi.fn(),
      }),
    }))

    const vol = memfs.vol
    vol.fromJSON({
      '/cedar-app/web/vite.config.ts': `import dns from 'dns'
import { defineConfig } from 'vite'
import { cedar } from '@cedarjs/vite'

dns.setDefaultResultOrder('verbatim')

export default defineConfig({
  plugins: [cedar()],
})`,
    })

    const { handler } = await import('../providers/universalDeployHandler.js')

    await handler({ force: false })

    const written = (vol.toJSON() as Record<string, string>)[
      '/cedar-app/web/vite.config.ts'
    ]
    expect(written).toBeDefined()
    expect(written).toContain('cedarUniversalDeployPlugin')
    expect(written).toContain(
      `import { cedar, cedarUniversalDeployPlugin } from '@cedarjs/vite'`,
    )
    expect(written).toContain('cedarUniversalDeployPlugin()')
  })
})
