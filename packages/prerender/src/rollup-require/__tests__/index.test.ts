import fs from 'node:fs'
import path from 'node:path'

import { vi, expect, test, assert } from 'vitest'

import type * as ProjectConfig from '@cedarjs/project-config'

import { rollupRequire } from '../rollup-require'
import { JS_EXT_RE } from '../utils'

vi.mock('@cedarjs/project-config', async (importOriginal) => {
  const originalProjectConfig = await importOriginal<typeof ProjectConfig>()

  return {
    ...originalProjectConfig,
    getPaths: () => {
      return {
        api: {
          base: '/mocked/project/api',
        },
        web: {
          base: '/mocked/project/web',
          dist: '/mocked/project/web/dist',
          src: '/mocked/project/web/src',
        },
      }
    },
    getConfig: () => {
      return {
        graphql: {},
      }
    },
  }
})

function getFixtureFile(folderName: string, fileName?: string) {
  const filepath = path.join(
    __dirname,
    'fixtures',
    folderName,
    fileName || 'input.ts',
  )

  return filepath
}

test('main', async () => {
  const { mod, dependencies } = await rollupRequire({
    filepath: getFixtureFile('main'),
  })

  expect(mod.default.a.filename).toMatch(/[\\/]main[\\/]a\.ts$/)
  expect(dependencies.length).toEqual(2)
  expect(dependencies[0]).toMatch(/[\\/]main[\\/]a.ts$/)
  expect(dependencies[1]).toMatch(/[\\/]main[\\/]input.ts$/)
})

test('preserveTemporaryFile', async () => {
  const filepath = getFixtureFile('preserve-temporary-file')

  await rollupRequire({
    filepath,
    preserveTemporaryFile: true,
    getOutputFile: (filepath: string) => {
      // Doing this to set a deterministic filename
      return filepath.replace(JS_EXT_RE, `.bundled.mjs`)
    },
  })

  const outputFile = path.join(
    __dirname,
    './fixtures/preserve-temporary-file/input.bundled.mjs',
  )

  assert.equal(fs.existsSync(outputFile), true)
  fs.unlinkSync(outputFile)
})

test('ignore node_modules', async () => {
  const filepath = getFixtureFile('ignore-node_modules')

  try {
    await rollupRequire({ filepath })
    assert.equal(true, false)
  } catch (error: any) {
    expect(error.message).toMatch(/Failed to load url foo/)
  }
})

test('resolve tsconfig paths', async () => {
  const filepath = getFixtureFile('resolve-tsconfig-paths')

  const { mod } = await rollupRequire({
    filepath,
    cwd: path.join(__dirname, './fixtures/resolve-tsconfig-paths'),
  })

  assert.equal(mod.foo, 'foo')
})

test('replace import.meta.url', async () => {
  const dir = path.join(__dirname, './fixtures/replace-path')
  const filepath = getFixtureFile('replace-path')

  const { mod } = await rollupRequire({ filepath, cwd: dir })

  assert.equal(mod.dir, dir)
  assert.equal(mod.file, filepath)
  assert.equal(mod.importMetaUrl, `file://${path.join(dir, 'input.ts')}`)
})
