/**
 * @vitest-environment node
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  cedarVitestWebConfigPlugin,
  SETUP_FILE,
  setupFileCacheKey,
  TENANCY_WEB_MODULE_ID,
} from '../vite-plugin-cedar-vitest-web-config.js'

describe('the tenancy module of cedarVitestWebConfigPlugin', () => {
  // A monorepo, with the app in `app/`
  let rootDir: string
  let server: ViteDevServer | undefined
  const originalCwd = process.env.CEDAR_CWD

  const appDir = () => path.join(rootDir, 'app')

  const write = (file: string, content: unknown) => {
    const filePath = path.join(rootDir, file)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(
      filePath,
      typeof content === 'string' ? content : JSON.stringify(content),
    )
  }

  const writeTenancy = (nodeModulesDir: string) => {
    write(path.join(nodeModulesDir, '@cedarjs/tenancy/package.json'), {
      name: '@cedarjs/tenancy',
      type: 'module',
      exports: { './web': { default: './dist/web/index.js' } },
    })
    write(
      path.join(nodeModulesDir, '@cedarjs/tenancy/dist/web/index.js'),
      'export async function clearOrgClients() {}',
    )
  }

  const startServer = async () => {
    server = await createServer({
      configFile: false,
      root: path.join(appDir(), 'web'),
      logLevel: 'silent',
      server: { middlewareMode: true, ws: false },
      optimizeDeps: { noDiscovery: true, include: [] },
      plugins: [cedarVitestWebConfigPlugin()],
    })

    return server
  }

  const resolveTenancyModule = async () => {
    const { pluginContainer } = await startServer()
    const resolved = await pluginContainer.resolveId(TENANCY_WEB_MODULE_ID)

    return {
      id: resolved?.id,
      code: resolved ? await pluginContainer.load(resolved.id) : undefined,
    }
  }

  beforeEach(() => {
    rootDir = fs.mkdtempSync(
      path.join(fs.realpathSync(os.tmpdir()), 'cedar-vitest-web-config-'),
    )
    process.env.CEDAR_CWD = appDir()
    write('app/cedar.toml', '')
  })

  afterEach(async () => {
    await server?.close()
    server = undefined
    process.env.CEDAR_CWD = originalCwd
    fs.rmSync(rootDir, { recursive: true, force: true })
  })

  it("is the app's @cedarjs/tenancy/web when the web side lists it", async () => {
    write('app/web/package.json', {
      dependencies: { '@cedarjs/tenancy': '1.0.0' },
    })
    writeTenancy('app/node_modules')
    // Another app's copy, further up the tree
    writeTenancy('node_modules')

    const { id } = await resolveTenancyModule()

    expect(id).toBe(
      path.join(appDir(), 'node_modules/@cedarjs/tenancy/dist/web/index.js'),
    )
  })

  it("is the same module as the app's own imports get", async () => {
    write('app/web/package.json', {
      devDependencies: { '@cedarjs/tenancy': '1.0.0' },
    })
    writeTenancy('app/web/node_modules')

    const { pluginContainer } = await startServer()
    const appImport = await pluginContainer.resolveId(
      '@cedarjs/tenancy/web',
      path.join(appDir(), 'web/src/App.tsx'),
    )
    const setupImport = await pluginContainer.resolveId(
      TENANCY_WEB_MODULE_ID,
      path.join(
        appDir(),
        'node_modules/@cedarjs/testing/dist/web/vitest/vitest-web.setup.js',
      ),
    )

    expect(appImport?.id).toBeDefined()
    expect(setupImport?.id).toBe(appImport?.id)
  })

  it('has no clearOrgClients in an app without tenancy', async () => {
    write('app/web/package.json', { dependencies: {} })

    const { id, code } = await resolveTenancyModule()

    expect(id).toBe('\0' + TENANCY_WEB_MODULE_ID)
    expect(code).toBe('export const clearOrgClients = undefined')
  })

  it("has no clearOrgClients when only an ancestor's node_modules has tenancy", async () => {
    write('app/web/package.json', { dependencies: {} })
    writeTenancy('node_modules')

    const { id, code } = await resolveTenancyModule()

    expect(id).toBe('\0' + TENANCY_WEB_MODULE_ID)
    expect(code).toBe('export const clearOrgClients = undefined')
  })

  it("fails when the web side lists tenancy but can't resolve it", async () => {
    write('app/web/package.json', {
      dependencies: { '@cedarjs/tenancy': '1.0.0' },
    })

    await expect(resolveTenancyModule()).rejects.toThrow(
      "@cedarjs/tenancy/web can't be resolved from the web side",
    )
  })

  describe('setupFileCacheKey', () => {
    it('changes when the app gets tenancy', () => {
      write('app/web/package.json', { dependencies: {} })
      writeTenancy('node_modules')
      const withoutTenancy = setupFileCacheKey(SETUP_FILE)

      write('app/web/package.json', {
        dependencies: { '@cedarjs/tenancy': '1.0.0' },
      })
      const unresolvedTenancy = setupFileCacheKey(SETUP_FILE)

      writeTenancy('app/node_modules')
      const withTenancy = setupFileCacheKey(SETUP_FILE)

      expect(
        new Set([withoutTenancy, unresolvedTenancy, withTenancy]).size,
      ).toBe(3)
      expect(withTenancy).toContain(
        path.join(appDir(), 'node_modules/@cedarjs/tenancy/dist/web/index.js'),
      )
    })

    it('leaves the keys of other modules alone', () => {
      write('app/web/package.json', {
        dependencies: { '@cedarjs/tenancy': '1.0.0' },
      })

      expect(
        setupFileCacheKey(path.join(appDir(), 'web/src/App.tsx')),
      ).toBeUndefined()
    })
  })
})
