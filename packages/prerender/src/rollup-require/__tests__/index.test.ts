import fs from 'node:fs'
import path from 'node:path'

import { test, assert } from 'vitest'

import {
  rollupRequire,
  JS_EXT_RE,
} from '../../../dist/rollup-require/rollup-require'

test('main', async () => {
  const { mod, dependencies } = await rollupRequire({
    filepath: path.join(__dirname, './fixtures/input.ts'),
  })
  assert.equal(mod.default.a.filename.endsWith('a.ts'), true)
  assert.deepEqual(dependencies, ['test/fixture/a.ts', 'test/fixture/input.ts'])
})

test('preserveTemporaryFile', async () => {
  await rollupRequire({
    filepath: path.join(
      __dirname,
      './fixtures/preserve-temporary-file/input.ts',
    ),
    preserveTemporaryFile: true,
    getOutputFile: (filepath: string) =>
      filepath.replace(JS_EXT_RE, `.bundled.mjs`),
  })
  const outputFile = path.join(
    __dirname,
    './fixtures/preserve-temporary-file/input.bundled.mjs',
  )
  assert.equal(fs.existsSync(outputFile), true)
  fs.unlinkSync(outputFile)
})

test('ignore node_modules', async () => {
  try {
    await rollupRequire({
      filepath: path.join(__dirname, './fixtures/ignore-node_modules/input.ts'),
    })
  } catch (error: any) {
    assert.equal(error.code, 'ERR_MODULE_NOT_FOUND')
  }
})

test('resolve tsconfig paths', async () => {
  const { mod } = await rollupRequire({
    filepath: path.join(
      __dirname,
      './fixtures/resolve-tsconfig-paths/input.ts',
    ),
    cwd: path.join(__dirname, './fixtures/resolve-tsconfig-paths'),
  })
  assert.equal(mod.foo, 'foo')
})

test('replace import.meta.url', async () => {
  const dir = path.join(__dirname, './fixtures/replace-path')
  const { mod } = await rollupRequire({
    filepath: path.join(dir, 'input.ts'),
    cwd: dir,
  })
  assert.equal(mod.dir, dir)
  assert.equal(mod.file, path.join(dir, 'input.ts'))
  assert.equal(mod.importMetaUrl, `file://${path.join(dir, 'input.ts')}`)
})
