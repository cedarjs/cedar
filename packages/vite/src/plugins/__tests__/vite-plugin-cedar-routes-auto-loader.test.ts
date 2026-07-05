import path from 'node:path'

import { vol } from 'memfs'
import dedent from 'ts-dedent'
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'

import type * as ProjectConfig from '@cedarjs/project-config'
import { processPagesDir } from '@cedarjs/project-config'

import { cedarRoutesAutoLoaderPlugin } from '../vite-plugin-cedar-routes-auto-loader.js'

vi.mock('node:fs', async () => ({ default: (await import('memfs')).fs }))

const TEST_CEDAR_CWD = '/Users/tobbe/test-app/'
const CEDAR_CWD = process.env.CEDAR_CWD
process.env.CEDAR_CWD = TEST_CEDAR_CWD

const ROUTES_FILE = path.join(TEST_CEDAR_CWD, 'web/src/Routes.tsx')

const mockPages = [
  {
    importName: 'HomePage',
    constName: 'HomePage',
    importPath: path.join(TEST_CEDAR_CWD, 'web/src/pages/HomePage/HomePage'),
    path: path.join(TEST_CEDAR_CWD, 'web/src/pages/HomePage/HomePage.tsx'),
    importStatement: '',
  },
  {
    importName: 'AboutPage',
    constName: 'AboutPage',
    importPath: path.join(TEST_CEDAR_CWD, 'web/src/pages/AboutPage/AboutPage'),
    path: path.join(TEST_CEDAR_CWD, 'web/src/pages/AboutPage/AboutPage.tsx'),
    importStatement: '',
  },
  {
    importName: 'NotFoundPage',
    constName: 'NotFoundPage',
    importPath: path.join(
      TEST_CEDAR_CWD,
      'web/src/pages/NotFoundPage/NotFoundPage',
    ),
    path: path.join(
      TEST_CEDAR_CWD,
      'web/src/pages/NotFoundPage/NotFoundPage.tsx',
    ),
    importStatement: '',
  },
]

vi.mock('@cedarjs/project-config', async (importOriginal) => {
  const originalProjectConfig = await importOriginal<typeof ProjectConfig>()
  return {
    ...originalProjectConfig,
    getPaths: () => ({
      ...originalProjectConfig.getPaths(),
      web: {
        ...originalProjectConfig.getPaths().web,
        src: path.join(TEST_CEDAR_CWD, 'web/src'),
        base: path.join(TEST_CEDAR_CWD, 'web'),
        routes: ROUTES_FILE,
      },
    }),
    processPagesDir: vi.fn(() => mockPages),
    // resolveFile is used for src/-prefixed imports and App.tsx detection.
    // Only resolve paths of the form /…/PageName/PageName (the canonical page
    // file pattern). Bare directory paths like /…/pages/HomePage should return
    // null so that the plugin tries the next candidate (PageName/PageName).
    resolveFile: vi.fn((filePath: string) => {
      if (filePath.endsWith('/App')) {
        return null
      }
      const parts = filePath.split('/')
      const last = parts[parts.length - 1]
      const secondToLast = parts[parts.length - 2]
      // Match the PageName/PageName pattern (e.g. HomePage/HomePage)
      if (last === secondToLast && filePath.includes('/pages/')) {
        return filePath + '.tsx'
      }
      return null
    }),
    importStatementPath: originalProjectConfig.importStatementPath,
    ensurePosixPath: originalProjectConfig.ensurePosixPath,
  }
})

function getPluginTransform() {
  const plugin = cedarRoutesAutoLoaderPlugin()

  if (typeof plugin.transform !== 'function') {
    expect.fail('Expected plugin to have a transform function')
  }

  return plugin.transform.bind({} as ThisParameterType<typeof plugin.transform>)
}

beforeAll(() => {
  vol.fromJSON({ 'redwood.toml': '' }, TEST_CEDAR_CWD)
})

afterAll(() => {
  process.env.CEDAR_CWD = CEDAR_CWD
})

describe('cedarRoutesAutoLoaderPlugin', () => {
  it('skips files that are not the Routes file', () => {
    const transform = getPluginTransform()

    const result = transform(
      `import React from 'react'`,
      '/some/other/file.tsx',
    )

    expect(result).toBeNull()
  })

  it('adds lazy declarations for all pages not already imported', () => {
    const routesCode = dedent`
      import { Router, Route } from '@cedarjs/router'

      const Routes = () => {
        return (
          <Router>
            <Route path="/" page={HomePage} name="home" />
            <Route path="/about" page={AboutPage} name="about" />
            <Route notfound page={NotFoundPage} />
          </Router>
        )
      }

      export default Routes
    `

    const transform = getPluginTransform()
    const result = transform(routesCode, ROUTES_FILE)

    expect(result).not.toBeNull()
    expect(result?.code).toContain(
      dedent`
        const HomePage = {
          name: "HomePage",
          prerenderLoader: (name) => ({ default: globalThis.__REDWOOD__PRERENDER_PAGES[name] }),
          LazyComponent: lazy(() => import("./pages/HomePage/HomePage")),
        }
      `,
    )
    expect(result?.code).toContain(
      dedent`
        const AboutPage = {
          name: "AboutPage",
          prerenderLoader: (name) => ({ default: globalThis.__REDWOOD__PRERENDER_PAGES[name] }),
          LazyComponent: lazy(() => import("./pages/AboutPage/AboutPage")),
        }
      `,
    )
    expect(result?.code).toContain(
      dedent`
        const NotFoundPage = {
          name: "NotFoundPage",
          prerenderLoader: (name) => ({ default: globalThis.__REDWOOD__PRERENDER_PAGES[name] }),
          LazyComponent: lazy(() => import("./pages/NotFoundPage/NotFoundPage")),
        }
      `,
    )
    expect(result?.code).toContain(`import { lazy } from 'react'`)
    // Original code should be preserved
    expect(result?.code).toContain(
      `import { Router, Route } from '@cedarjs/router'`,
    )
  })

  it('does not add a lazy declaration for an explicitly imported page', () => {
    const routesCode = dedent`
      import { Router, Route } from '@cedarjs/router'
      import HomePage from 'src/pages/HomePage'

      const Routes = () => {
        return (
          <Router>
            <Route path="/" page={HomePage} name="home" />
            <Route path="/about" page={AboutPage} name="about" />
            <Route notfound page={NotFoundPage} />
          </Router>
        )
      }

      export default Routes
    `

    const transform = getPluginTransform()
    const result = transform(routesCode, ROUTES_FILE)

    expect(result).not.toBeNull()
    // HomePage should not get a lazy declaration since it's explicitly imported
    expect(result?.code).not.toContain('const HomePage =')
    // Other pages should still get declarations
    expect(result?.code).toContain('const AboutPage =')
    expect(result?.code).toContain('const NotFoundPage =')
    // The explicit import should be preserved
    expect(result?.code).toContain(`import HomePage from 'src/pages/HomePage'`)
  })

  it('returns null when all pages are already explicitly imported', () => {
    const routesCode = dedent`
      import { Router, Route } from '@cedarjs/router'
      import HomePage from 'src/pages/HomePage'
      import AboutPage from 'src/pages/AboutPage'
      import NotFoundPage from 'src/pages/NotFoundPage'

      const Routes = () => {
        return <Router><Route path="/" page={HomePage} name="home" /></Router>
      }

      export default Routes
    `

    const transform = getPluginTransform()
    const result = transform(routesCode, ROUTES_FILE)

    expect(result).toBeNull()
  })

  it('map is null in the result', () => {
    const routesCode = dedent`
      import { Router, Route } from '@cedarjs/router'

      const Routes = () => (
        <Router>
          <Route path="/" page={HomePage} name="home" />
        </Router>
      )

      export default Routes
    `

    const transform = getPluginTransform()
    const result = transform(routesCode, ROUTES_FILE)

    expect(result?.map).toBeNull()
  })

  it('filters out explicitly imported pages with file extensions', () => {
    const routesCode = dedent`
      import { Router, Route } from '@cedarjs/router'
      import HomePage from './pages/HomePage/HomePage.tsx'

      const Routes = () => {
        return (
          <Router>
            <Route path="/" page={HomePage} name="home" />
            <Route path="/about" page={AboutPage} name="about" />
          </Router>
        )
      }

      export default Routes
    `

    const transform = getPluginTransform()
    const result = transform(routesCode, ROUTES_FILE)

    expect(result).not.toBeNull()
    // HomePage should not get a lazy declaration despite the .tsx extension
    expect(result?.code).not.toContain('const HomePage =')
    // AboutPage should still get a declaration
    expect(result?.code).toContain('const AboutPage =')
  })

  it('filters out composite imports (import Foo, { ... } from)', () => {
    const routesCode = dedent`
      import { Router, Route } from '@cedarjs/router'
      import HomePage, { useHomePage } from 'src/pages/HomePage'

      const Routes = () => {
        return (
          <Router>
            <Route path="/" page={HomePage} name="home" />
            <Route path="/about" page={AboutPage} name="about" />
          </Router>
        )
      }

      export default Routes
    `

    const transform = getPluginTransform()
    const result = transform(routesCode, ROUTES_FILE)

    expect(result).not.toBeNull()
    // HomePage should not get a lazy declaration despite composite import
    expect(result?.code).not.toContain('const HomePage =')
    // AboutPage should still get a declaration
    expect(result?.code).toContain('const AboutPage =')
  })
})

describe('cedarRoutesAutoLoaderPlugin — duplicate pages', () => {
  it('throws for duplicate page names', () => {
    vi.mocked(processPagesDir).mockReturnValueOnce([
      ...mockPages,
      {
        importName: 'HomePage',
        constName: 'HomePage',
        importPath: path.join(
          TEST_CEDAR_CWD,
          'web/src/pages/HomePage/useHomePage',
        ),
        path: path.join(
          TEST_CEDAR_CWD,
          'web/src/pages/HomePage/useHomePage.tsx',
        ),
        importStatement: '',
      },
    ])

    expect(() => cedarRoutesAutoLoaderPlugin()).toThrow(
      "Unable to find only a single file ending in 'Page.{js,jsx,ts,tsx}' " +
        "in the following page directories: 'HomePage'",
    )
  })
})
