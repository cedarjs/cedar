globalThis.__dirname = import.meta.dirname

import type * as NodeFs from 'node:fs'

import { vol, fs as memfs } from 'memfs'
import { ufs } from 'unionfs'
import { vi, describe, beforeEach, test, expect } from 'vitest'

import '../../../../lib/test'

import {
  isAuthSetup,
  hasLoginRoute,
  getUnauthenticatedRedirectRoute,
} from '../scaffoldHandler.js'

vi.mock('node:fs', async (importOriginal) => {
  const { wrapFsForUnionfs, wrapMemfsForUnionfs } =
    await import('../../../../__tests__/ufsFsProxy.js')
  const fs = await importOriginal<typeof NodeFs>()
  ufs.use(wrapFsForUnionfs(fs)).use(wrapMemfsForUnionfs(memfs))
  return { ...ufs, default: { ...ufs } }
})
vi.mock('execa')

describe('isAuthSetup', () => {
  beforeEach(() => {
    vol.reset()
    vol.fromJSON({ 'redwood.toml': '' }, '/')
  })

  test('returns false when web/src/auth.{ts,js,tsx,jsx} does not exist', () => {
    expect(isAuthSetup()).toBe(false)
  })

  test('returns true when web/src/auth.ts exists', () => {
    vol.fromJSON(
      { 'web/src/auth.ts': 'export const { AuthProvider } = createAuth()' },
      '/path/to/project',
    )

    expect(isAuthSetup()).toBe(true)
  })

  test('returns true when web/src/auth.tsx exists', () => {
    vol.fromJSON(
      { 'web/src/auth.tsx': 'export const { AuthProvider } = createAuth()' },
      '/path/to/project',
    )

    expect(isAuthSetup()).toBe(true)
  })

  test('returns false when an unrelated web/src file exists', () => {
    vol.fromJSON(
      { 'web/src/App.tsx': 'export default App' },
      '/path/to/project',
    )

    expect(isAuthSetup()).toBe(false)
  })
})

describe('hasLoginRoute', () => {
  beforeEach(() => {
    vol.reset()
    vol.fromJSON({ 'redwood.toml': '' }, '/')
  })

  test('returns false when Routes file does not exist', () => {
    expect(hasLoginRoute()).toBe(false)
  })

  test('returns false when Routes file exists but has no login route', () => {
    vol.fromJSON(
      {
        'web/src/Routes.js': `
import { Router, Route } from '@cedarjs/router'
export const Routes = () => (
  <Router>
    <Route path="/" page={HomePage} name="home" />
  </Router>
)
`,
      },
      '/path/to/project',
    )

    expect(hasLoginRoute()).toBe(false)
  })

  test('returns true when Routes file has a route named "login"', () => {
    vol.fromJSON(
      {
        'web/src/Routes.js': `
import { Router, Route } from '@cedarjs/router'
export const Routes = () => (
  <Router>
    <Route path="/" page={HomePage} name="home" />
    <Route path="/login" page={LoginPage} name="login" />
  </Router>
)
`,
      },
      '/path/to/project',
    )

    expect(hasLoginRoute()).toBe(true)
  })

  test('returns true when login is defined with single quotes', () => {
    vol.fromJSON(
      {
        'web/src/Routes.js': `
import { Router, Route } from '@cedarjs/router'
export const Routes = () => (
  <Router>
    <Route path='/' page={HomePage} name='home' />
    <Route path='/login' page={LoginPage} name='login' />
  </Router>
)
`,
      },
      '/path/to/project',
    )

    expect(hasLoginRoute()).toBe(true)
  })

  test('returns false when login is in a comment', () => {
    vol.fromJSON(
      {
        'web/src/Routes.js': `
import { Router, Route } from '@cedarjs/router'
// This route name="login" in the comment should not match
export const Routes = () => (
  <Router>
    <Route path="/" page={HomePage} name="home" />
  </Router>
)
`,
      },
      '/path/to/project',
    )

    expect(hasLoginRoute()).toBe(false)
  })

  test('returns false when login is in a string literal', () => {
    vol.fromJSON(
      {
        'web/src/Routes.js': `
import { Router, Route } from '@cedarjs/router'
const routeConfig = 'name="login"'
export const Routes = () => (
  <Router>
    <Route path="/" page={HomePage} name="home" />
  </Router>
)
`,
      },
      '/path/to/project',
    )

    expect(hasLoginRoute()).toBe(false)
  })

  test('returns false when login is in a non-Route element', () => {
    vol.fromJSON(
      {
        'web/src/Routes.js': `
import { Router, Route } from '@cedarjs/router'
export const Routes = () => (
  <Router>
    <Route path="/" page={HomePage} name="home" />
    <CustomElement name="login" />
  </Router>
)
`,
      },
      '/path/to/project',
    )

    expect(hasLoginRoute()).toBe(false)
  })

  test('returns false when login route is nested inside PrivateSet', () => {
    vol.fromJSON(
      {
        'web/src/Routes.js': `
import { Router, Route, PrivateSet } from '@cedarjs/router'
export const Routes = () => (
  <Router>
    <PrivateSet>
      <Route path="/login" page={LoginPage} name="login" />
    </PrivateSet>
  </Router>
)
`,
      },
      '/path/to/project',
    )

    expect(hasLoginRoute()).toBe(false)
  })

  test('returns true when login route is outside an aliased PrivateSet', () => {
    vol.fromJSON(
      {
        'web/src/Routes.js': `
import { Router, Route, PrivateSet as AuthSet } from '@cedarjs/router'
export const Routes = () => (
  <Router>
    <Route path="/login" page={LoginPage} name="login" />
    <AuthSet>
      <Route path="/home" page={HomePage} name="home" />
    </AuthSet>
  </Router>
)
`,
      },
      '/path/to/project',
    )

    expect(hasLoginRoute()).toBe(true)
  })

  test('returns false when login route is inside an aliased PrivateSet', () => {
    vol.fromJSON(
      {
        'web/src/Routes.js': `
import { Router, Route, PrivateSet as AuthSet } from '@cedarjs/router'
export const Routes = () => (
  <Router>
    <AuthSet>
      <Route path="/login" page={LoginPage} name="login" />
    </AuthSet>
  </Router>
)
`,
      },
      '/path/to/project',
    )

    expect(hasLoginRoute()).toBe(false)
  })

  test('returns false when login route is inside a namespaced PrivateSet', () => {
    vol.fromJSON(
      {
        'web/src/Routes.js': `
import * as CedarRouter from '@cedarjs/router'
export const Routes = () => (
  <CedarRouter.Router>
    <CedarRouter.PrivateSet>
      <CedarRouter.Route path="/login" page={LoginPage} name="login" />
    </CedarRouter.PrivateSet>
  </CedarRouter.Router>
)
`,
      },
      '/path/to/project',
    )

    expect(hasLoginRoute()).toBe(false)
  })

  test('returns true when login route is outside a namespaced PrivateSet', () => {
    vol.fromJSON(
      {
        'web/src/Routes.js': `
import * as CedarRouter from '@cedarjs/router'
export const Routes = () => (
  <CedarRouter.Router>
    <CedarRouter.Route path="/login" page={LoginPage} name="login" />
    <CedarRouter.PrivateSet>
      <CedarRouter.Route path="/home" page={HomePage} name="home" />
    </CedarRouter.PrivateSet>
  </CedarRouter.Router>
)
`,
      },
      '/path/to/project',
    )

    expect(hasLoginRoute()).toBe(true)
  })

  test('returns false when Route is locally defined (not from @cedarjs/router)', () => {
    vol.fromJSON(
      {
        'web/src/Routes.js': `
const Route = ({ name, path, page }) => null
export const Routes = () => (
  <Router>
    <Route path="/login" page={LoginPage} name="login" />
  </Router>
)
`,
      },
      '/path/to/project',
    )

    expect(hasLoginRoute()).toBe(false)
  })

  test('returns false when Route is from a different library', () => {
    vol.fromJSON(
      {
        'web/src/Routes.js': `
import { Route } from 'react-router-dom'
export const Routes = () => (
  <Router>
    <Route path="/login" page={LoginPage} name="login" />
  </Router>
)
`,
      },
      '/path/to/project',
    )

    expect(hasLoginRoute()).toBe(false)
  })

  test('returns false when namespaced Route is from a different library', () => {
    vol.fromJSON(
      {
        'web/src/Routes.js': `
import * as ReactRouter from 'react-router-dom'
export const Routes = () => (
  <ReactRouter.Router>
    <ReactRouter.Route path="/login" page={LoginPage} name="login" />
  </ReactRouter.Router>
)
`,
      },
      '/path/to/project',
    )

    expect(hasLoginRoute()).toBe(false)
  })

  test('returns true when Route is aliased from @cedarjs/router', () => {
    vol.fromJSON(
      {
        'web/src/Routes.js': `
import { Route as CedarRoute } from '@cedarjs/router'
export const Routes = () => (
  <Router>
    <CedarRoute path="/login" page={LoginPage} name="login" />
  </Router>
)
`,
      },
      '/path/to/project',
    )

    expect(hasLoginRoute()).toBe(true)
  })
})

describe('getUnauthenticatedRedirectRoute', () => {
  beforeEach(() => {
    vol.reset()
    vol.fromJSON({ 'redwood.toml': '' }, '/')
  })

  test('returns undefined when auth is not set up, even with a login route', () => {
    vol.fromJSON(
      {
        'web/src/Routes.js': `
import { Router, Route } from '@cedarjs/router'
export const Routes = () => (
  <Router>
    <Route path="/" page={HomePage} name="home" />
    <Route path="/login" page={LoginPage} name="login" />
  </Router>
)
`,
      },
      '/path/to/project',
    )

    expect(getUnauthenticatedRedirectRoute()).toBe(undefined)
  })

  test('returns "login" when auth is set up and a login route exists', () => {
    vol.fromJSON(
      {
        'web/src/auth.ts': 'export const { AuthProvider } = createAuth()',
        'web/src/Routes.js': `
import { Router, Route } from '@cedarjs/router'
export const Routes = () => (
  <Router>
    <Route path="/" page={HomePage} name="home" />
    <Route path="/login" page={LoginPage} name="login" />
  </Router>
)
`,
      },
      '/path/to/project',
    )

    expect(getUnauthenticatedRedirectRoute()).toBe('login')
  })

  test('falls back to the landing page route when auth is set up but there is no login route', () => {
    vol.fromJSON(
      {
        'web/src/auth.ts': 'export const { AuthProvider } = createAuth()',
        'web/src/Routes.js': `
import { Router, Route } from '@cedarjs/router'
export const Routes = () => (
  <Router>
    <Route path="/" page={HomePage} name="home" />
  </Router>
)
`,
      },
      '/path/to/project',
    )

    expect(getUnauthenticatedRedirectRoute()).toBe('home')
  })

  test('falls back to the landing page route even when it has a non-standard name', () => {
    vol.fromJSON(
      {
        'web/src/auth.ts': 'export const { AuthProvider } = createAuth()',
        'web/src/Routes.js': `
import { Router, Route } from '@cedarjs/router'
export const Routes = () => (
  <Router>
    <Route path="/" page={LandingPage} name="landing" />
  </Router>
)
`,
      },
      '/path/to/project',
    )

    expect(getUnauthenticatedRedirectRoute()).toBe('landing')
  })

  test('returns undefined when auth is set up but there is no login route or landing page route', () => {
    vol.fromJSON(
      {
        'web/src/auth.ts': 'export const { AuthProvider } = createAuth()',
        'web/src/Routes.js': `
import { Router, Route } from '@cedarjs/router'
export const Routes = () => (
  <Router>
    <Route path="/about" page={AboutPage} name="about" />
  </Router>
)
`,
      },
      '/path/to/project',
    )

    expect(getUnauthenticatedRedirectRoute()).toBe(undefined)
  })

  test('returns undefined when auth is not set up and there is no login or landing route', () => {
    vol.fromJSON(
      {
        'web/src/Routes.js': `
import { Router, Route } from '@cedarjs/router'
export const Routes = () => (
  <Router>
    <Route path="/about" page={AboutPage} name="about" />
  </Router>
)
`,
      },
      '/path/to/project',
    )

    expect(getUnauthenticatedRedirectRoute()).toBe(undefined)
  })

  test('skips a protected landing page route (nested in PrivateSet)', () => {
    vol.fromJSON(
      {
        'web/src/auth.ts': 'export const { AuthProvider } = createAuth()',
        'web/src/Routes.js': `
import { Router, Route, PrivateSet } from '@cedarjs/router'
export const Routes = () => (
  <Router>
    <PrivateSet>
      <Route path="/" page={HomePage} name="home" />
    </PrivateSet>
  </Router>
)
`,
      },
      '/path/to/project',
    )

    expect(getUnauthenticatedRedirectRoute()).toBe(undefined)
  })

  test('uses the landing page route if it exists alongside a protected one', () => {
    vol.fromJSON(
      {
        'web/src/auth.ts': 'export const { AuthProvider } = createAuth()',
        'web/src/Routes.js': `
import { Router, Route, PrivateSet } from '@cedarjs/router'
export const Routes = () => (
  <Router>
    <Route path="/" page={LandingPage} name="landing" />
    <PrivateSet>
      <Route path="/home" page={HomePage} name="home" />
    </PrivateSet>
  </Router>
)
`,
      },
      '/path/to/project',
    )

    expect(getUnauthenticatedRedirectRoute()).toBe('landing')
  })

  test('falls back to landing page when login route is protected', () => {
    vol.fromJSON(
      {
        'web/src/auth.ts': 'export const { AuthProvider } = createAuth()',
        'web/src/Routes.js': `
import { Router, Route, PrivateSet } from '@cedarjs/router'
export const Routes = () => (
  <Router>
    <Route path="/" page={LandingPage} name="landing" />
    <PrivateSet>
      <Route path="/login" page={LoginPage} name="login" />
    </PrivateSet>
  </Router>
)
`,
      },
      '/path/to/project',
    )

    expect(getUnauthenticatedRedirectRoute()).toBe('landing')
  })

  test('returns undefined when login route is protected and no landing page exists', () => {
    vol.fromJSON(
      {
        'web/src/auth.ts': 'export const { AuthProvider } = createAuth()',
        'web/src/Routes.js': `
import { Router, Route, PrivateSet } from '@cedarjs/router'
export const Routes = () => (
  <Router>
    <PrivateSet>
      <Route path="/login" page={LoginPage} name="login" />
    </PrivateSet>
  </Router>
)
`,
      },
      '/path/to/project',
    )

    expect(getUnauthenticatedRedirectRoute()).toBe(undefined)
  })
})
