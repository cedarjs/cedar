import fs from 'fs'
import path from 'path'

import type { TransformPluginContext } from 'rollup'

import { getPaths } from '@cedarjs/project-config'

import { cedarjsRoutesAutoLoaderPlugin } from '../rollup-plugin-cedarjs-routes-auto-loader'
import { dedent } from '../utils'

const transform = (filename: string) => {
  const code = fs.readFileSync(filename, 'utf-8')
  const plugin = cedarjsRoutesAutoLoaderPlugin()
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
    '../../../../../../__fixtures__/test-project/',
  )

  let result: { code?: string } | null

  beforeAll(() => {
    process.env.RWJS_CWD = FIXTURE_PATH
    result = transform(getPaths().web.routes)
  })

  afterAll(() => {
    delete process.env.RWJS_CWD
  })

  test('Pages get both a LazyComponent and a prerenderLoader', () => {
    expect(result?.code).toContain(
      dedent(6)`const AboutPage = {
        name: "AboutPage",
        prerenderLoader: (name) => {
          const chunkId = './AboutPage-__PRERENDER_CHUNK_ID.js';
          return require(chunkId);
        },
        LazyComponent: lazy(() => import("./pages/AboutPage/AboutPage"))
      }`,
    )
  })

  // See packages/router/src/page.ts for what a Spec is
  test('Nested pages get the correct Spec', () => {
    expect(result?.code).toContain(
      dedent(6)`const ContactNewContactPage = {
        name: "ContactNewContactPage",
        prerenderLoader: (name) => {
          const chunkId = './NewContactPage-__PRERENDER_CHUNK_ID.js';
          return require(chunkId);
        },
        LazyComponent: lazy(() => import("./pages/Contact/NewContactPage/NewContactPage"))
      }`,
    )
  })

  test('Already imported pages are left alone.', () => {
    expect(result?.code).toContain(`import HomePage from 'src/pages/HomePage'`)
  })

  test('Already imported pages are not lazy loaded', () => {
    expect(result?.code).not.toContain('const HomePage')
  })

  test('RSC specific code should not be added', () => {
    expect(result?.code).not.toContain('DummyComponent')
    expect(result?.code).not.toContain('= () => {}')
  })
})
