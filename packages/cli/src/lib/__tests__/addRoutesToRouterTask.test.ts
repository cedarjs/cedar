import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { vi, test, expect, beforeEach, afterEach } from 'vitest'

import type * as ProjectConfig from '@cedarjs/project-config'

let routesPath: string
let tmpDir: string

vi.mock('@cedarjs/project-config', async (importOriginal) => {
  const originalProjectConfig = await importOriginal<typeof ProjectConfig>()
  return {
    ...originalProjectConfig,
    getPaths: () => ({
      base: '/tmp/cedar-app',
      web: {
        // Populated per-test in beforeEach, read lazily via a getter so
        // each test can point at its own temp file.
        get routes() {
          return routesPath
        },
      },
    }),
  }
})

const { addRoutesToRouterTask } = await import('../index.js')

const ROUTES_TEMPLATE = `import { Router, Route, Set } from '@cedarjs/router'

const Routes = () => {
  return (
    <Router>
      <Route path="/" page={HomePage} name="home" />
    </Router>
  )
}

export default Routes
`

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cedar-routes-test-'))
  routesPath = path.join(tmpDir, 'Routes.tsx')
  fs.writeFileSync(routesPath, ROUTES_TEMPLATE, 'utf8')
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

test('wraps routes with just <Set> when no privateSetProps are given', () => {
  addRoutesToRouterTask(
    ['<Route path="/posts" page={PostsPage} name="posts" />'],
    'ScaffoldLayout',
    { title: 'Posts' },
  )

  const content = fs.readFileSync(routesPath, 'utf8')

  expect(content).toContain('<Set wrap={ScaffoldLayout} title="Posts">')
  expect(content).not.toContain('<PrivateSet')
})

test('wraps routes with <PrivateSet> around <Set> when privateSetProps are given', () => {
  addRoutesToRouterTask(
    ['<Route path="/posts" page={PostsPage} name="posts" />'],
    'ScaffoldLayout',
    { title: 'Posts' },
    { unauthenticated: 'login' },
  )

  const content = fs.readFileSync(routesPath, 'utf8')

  expect(content).toContain('<PrivateSet unauthenticated="login">')
  expect(content).toContain('<Set wrap={ScaffoldLayout} title="Posts">')
  expect(content).toContain('</Set>')
  expect(content).toContain('</PrivateSet>')

  // <PrivateSet> must wrap <Set>, not the other way around
  const privateSetIndex = content.indexOf('<PrivateSet')
  const setIndex = content.indexOf('<Set wrap=')
  const closeSetIndex = content.indexOf('</Set>')
  const closePrivateSetIndex = content.indexOf('</PrivateSet>')
  expect(privateSetIndex).toBeLessThan(setIndex)
  expect(closeSetIndex).toBeLessThan(closePrivateSetIndex)
})
