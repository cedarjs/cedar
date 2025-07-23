import fs from 'fs'
import path from 'path'

import type { TransformPluginContext } from 'rollup'

import { getPaths } from '@cedarjs/project-config'

import { cedarjsRoutesAutoLoaderPlugin } from '../rollup-plugin-cedarjs-routes-auto-loader'

const transform = (filename: string, forPrerender = false) => {
  const code = fs.readFileSync(filename, 'utf-8')
  const plugin = cedarjsRoutesAutoLoaderPlugin({ forPrerender })
  const pluginTransform = plugin.transform

  if (typeof pluginTransform !== 'function') {
    throw new Error('Unexpeced transform type')
  }

  // Simulate rollup transform
  const result = pluginTransform.call(
    // The plugin is not using anything on the context, so this is safe
    {} as TransformPluginContext,
    code,
    filename,
  )

  if (typeof result === 'string') {
    return { code: result }
  } else if (result && typeof result === 'object' && 'code' in result) {
    return { code: result.code }
  }

  return { code }
}

describe('mulitiple files ending in Page.{js,jsx,ts,tsx}', () => {
  const FAILURE_FIXTURE_PATH = path.resolve(
    __dirname,
    './__fixtures__/route-auto-loader/failure',
  )

  beforeAll(() => {
    process.env.RWJS_CWD = FAILURE_FIXTURE_PATH
  })

  afterAll(() => {
    delete process.env.RWJS_CWD
  })

  test('Fails with appropriate message', () => {
    expect(() => {
      cedarjsRoutesAutoLoaderPlugin()
    }).toThrow(
      "Unable to find only a single file ending in 'Page.{js,jsx,ts,tsx}' " +
        "in the following page directories: 'HomePage'",
    )
  })
})

describe('page auto loader correctly imports pages', () => {
  const FIXTURE_PATH = path.resolve(
    __dirname,
    '../../../../../../__fixtures__/example-todo-main/',
  )

  let result: { code?: string } | null

  beforeAll(() => {
    process.env.RWJS_CWD = FIXTURE_PATH
  })

  afterAll(() => {
    delete process.env.RWJS_CWD
  })

  test('Pages get both a LazyComponent and a prerenderLoader', () => {
    result = transform(getPaths().web.routes)

    expect(result?.code).toContain(
      `const HomePage = {
        name: "HomePage",
        prerenderLoader: (name) => ({
          default: globalThis.__REDWOOD__PRERENDER_PAGES[name]
        }),
        LazyComponent: lazy(() => import("./pages/HomePage/HomePage"))
      }`
        .split('\n')
        .map((line) => line.replace(/^\s{6}/, ''))
        .join('\n'),
    )
  })

  test('Pages get both a LazyComponent and a prerenderLoader for prerender', () => {
    result = transform(getPaths().web.routes, true)

    expect(result?.code).toContain(
      `const HomePage = {
        name: "HomePage",
        prerenderLoader: (name) => {
            const chunkId = './HomePage-__PRERENDER_CHUNK_ID.js';
            return require(chunkId);
          },
        LazyComponent: lazy(() => import("./pages/HomePage/HomePage"))
      }`
        .split('\n')
        .map((line) => line.replace(/^\s{6}/, ''))
        .join('\n'),
    )
  })

  test('Already imported pages are left alone.', () => {
    expect(result?.code).toContain(`import FooPage from 'src/pages/FooPage'`)
  })

  test('Already imported pages are not lazy loaded', () => {
    expect(result?.code).not.toContain('const FooPage')
  })

  test('RSC specific code should not be added', () => {
    expect(result?.code).not.toContain('DummyComponent')
    expect(result?.code).not.toContain('= () => {}')
  })
})
