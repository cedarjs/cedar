import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'

test('all scripts are included in manifest.json', async () => {
  const nonScriptFiles = [
    'manifest.json',
    'package.json',
    'README.md',
    'manifest.test.ts',
  ]
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8')).sort()
  const scripts = fs
    .readdirSync('./')
    .filter((file) => !nonScriptFiles.includes(file))
    .sort()

  assert.deepStrictEqual(manifest, scripts)
})
