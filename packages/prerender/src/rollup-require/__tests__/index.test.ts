import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { vi, expect, test, assert } from 'vitest'

import type * as ProjectConfig from '@cedarjs/project-config'

import { buildAndImport } from '../buildAndImport'
import { JS_EXT_RE } from '../utils'

vi.mock('node:fs', async (importOriginal) => {
  const originalFs = await importOriginal<typeof fs>()

  return {
    ...originalFs,
    default: {
      ...originalFs,
      existsSync: () => true,
      mkdirSync: () => {},
      readFileSync: () => '',
      statSync: () => {},
      promises: {
        exists: () => true,
        mkdir: () => {},
        readFile: () => '',
        writeFile: () => {},
        rm: () => {},
      },
    },
  }
})

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
    processPagesDir: () => {
      const pagePaths = [
        '/mocked/project/web/src/pages/HomePage/HomePage.tsx',
        '/mocked/project/web/src/pages/TestPage/TestPage.tsx',
      ]

      return pagePaths.map((pagePath) => {
        const p = path.parse(pagePath)

        const importName = p.dir.replace(/\//g, '')
        const importPath = originalProjectConfig.importStatementPath(
          path.join('/mocked/project/web/src/pages', p.dir, p.name),
        )

        const importStatement = `const ${importName} = { name: '${importName}', loader: import('${importPath}') }`
        return {
          importName,
          constName: importName,
          importPath,
          path: path.join('/mocked/project/web/src/pages', pagePath),
          importStatement,
        }
      })
    },
  }
})

function getCwd(folderName: string) {
  const cwd = path.join(__dirname, 'fixtures', folderName)

  return cwd
}

test('main', async () => {
  const cwd = getCwd('main')
  const filepath = path.join(cwd, 'input.ts')
  const imported = await buildAndImport({ filepath, cwd })

  expect(imported.a.filename).toMatch(/[\\/]main[\\/]a\.ts$/)
})

test('preserveTemporaryFile', async () => {
  const cwd = getCwd('preserve-temporary-file')
  const filepath = path.join(cwd, 'input.ts')

  await buildAndImport({
    filepath,
    preserveTemporaryFile: true,
    cwd,
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
  const cwd = getCwd('ignore-node_modules')
  const filepath = path.join(cwd, 'input.ts')

  try {
    await buildAndImport({ filepath, cwd })
    assert.equal(true, false)
  } catch (error: any) {
    expect(error.message).toMatch(/Failed to load url foo/)
  }
})

test('resolve tsconfig paths', async () => {
  const cwd = getCwd('resolve-tsconfig-paths')
  const filepath = path.join(cwd, 'input.ts')

  const imported = await buildAndImport({ filepath, cwd })

  assert.equal(imported.foo, 'foo')
})

test('replace import.meta.url', async () => {
  const cwd = getCwd('replace-path')
  const filepath = path.join(cwd, 'input.ts')

  const imported = await buildAndImport({ filepath, cwd })

  expect(imported.dir).toEqual(cwd)
  expect(imported.file).toEqual(filepath)
  expect(imported.importMetaUrl).toMatch(/^file:\/\//)
  expect(imported.importMetaUrl).toEqual(pathToFileURL(filepath).href)
})
