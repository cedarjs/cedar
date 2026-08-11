import * as tsm from 'ts-morph'
import { describe, it, expect } from 'vitest'

import { createTSMSourceFile } from '../../x/ts-morph.js'
import { RWRoute } from '../RWRoute.js'
import type { RWRouter } from '../RWRouter.js'

/**
 * `RWRoute` only needs its `parent` (an `RWRouter`) for its `id` getter and
 * for path-collision/page lookups, none of which are exercised by the
 * `isPrivate`/`unauthenticated`/`roles` getters under test here. A stub
 * keeps these tests independent of a full `RWProject`/fixture on disk.
 */
const fakeRouter = {} as unknown as RWRouter

/**
 * Parses `src` and returns the `<Route .../>` self-closing element whose
 * `name` attribute matches `routeName`.
 */
function getRouteNode(
  src: string,
  routeName: string,
): tsm.JsxSelfClosingElement {
  const sf = createTSMSourceFile('/Routes.tsx', src)
  const routeNode = sf
    .getDescendantsOfKind(tsm.SyntaxKind.JsxSelfClosingElement)
    .find((x) => {
      if (x.getTagNameNode().getText() !== 'Route') {
        return false
      }
      const nameAttr = x.getAttribute('name')
      if (!nameAttr || !tsm.Node.isJsxAttribute(nameAttr)) {
        return false
      }
      const init = nameAttr.getInitializer()
      return (
        tsm.Node.isStringLiteral(init) && init.getLiteralValue() === routeName
      )
    })

  if (!routeNode) {
    throw new Error(`Could not find <Route name="${routeName}" /> in source`)
  }

  return routeNode
}

describe('RWRoute isPrivate/unauthenticated/roles ancestor walk', () => {
  it('is private for a route directly inside <PrivateSet>', () => {
    const src = `
      const Routes = () => (
        <Router>
          <PrivateSet unauthenticated="home" roles="admin">
            <Route path="/private" page={PrivatePage} name="privatePage" />
          </PrivateSet>
        </Router>
      )
    `
    const route = new RWRoute(getRouteNode(src, 'privatePage'), fakeRouter)

    expect(route.isPrivate).toBe(true)
    expect(route.unauthenticated).toBe('home')
    expect(route.roles).toBe('admin')
  })

  it('is private for a route inside a <Set> nested within <PrivateSet>', () => {
    const src = `
      const Routes = () => (
        <Router>
          <PrivateSet unauthenticated="home" roles="admin">
            <Set wrap={SomeLayout}>
              <Route path="/private" page={PrivatePage} name="privatePage" />
            </Set>
          </PrivateSet>
        </Router>
      )
    `
    const route = new RWRoute(getRouteNode(src, 'privatePage'), fakeRouter)

    expect(route.isPrivate).toBe(true)
    expect(route.unauthenticated).toBe('home')
    expect(route.roles).toBe('admin')
  })

  it('is not private for a route inside a plain <Set>', () => {
    const src = `
      const Routes = () => (
        <Router>
          <Set wrap={SomeLayout}>
            <Route path="/foo" page={FooPage} name="fooPage" />
          </Set>
        </Router>
      )
    `
    const route = new RWRoute(getRouteNode(src, 'fooPage'), fakeRouter)

    expect(route.isPrivate).toBe(false)
    expect(route.unauthenticated).toBeUndefined()
    expect(route.roles).toBeUndefined()
  })

  it('resolves unauthenticated from the nearest ancestor that has it', () => {
    const src = `
      const Routes = () => (
        <Router>
          <PrivateSet unauthenticated="home">
            <PrivateSet roles="admin">
              <Route path="/nested" page={NestedPage} name="nestedPage" />
            </PrivateSet>
          </PrivateSet>
        </Router>
      )
    `
    const route = new RWRoute(getRouteNode(src, 'nestedPage'), fakeRouter)

    expect(route.isPrivate).toBe(true)
    expect(route.unauthenticated).toBe('home')
  })

  it('prefers the inner ancestor when both wrappers set unauthenticated', () => {
    const src = `
      const Routes = () => (
        <Router>
          <PrivateSet unauthenticated="outer">
            <PrivateSet unauthenticated="inner">
              <Route path="/nested" page={NestedPage} name="nestedPage" />
            </PrivateSet>
          </PrivateSet>
        </Router>
      )
    `
    const route = new RWRoute(getRouteNode(src, 'nestedPage'), fakeRouter)

    expect(route.isPrivate).toBe(true)
    expect(route.unauthenticated).toBe('inner')
  })

  it('unions roles across two nested <PrivateSet> ancestors', () => {
    const src = `
      const Routes = () => (
        <Router>
          <PrivateSet unauthenticated="home" roles="admin">
            <PrivateSet roles={['owner', 'superuser']}>
              <Route path="/nested" page={NestedPage} name="nestedPage" />
            </PrivateSet>
          </PrivateSet>
        </Router>
      )
    `
    const route = new RWRoute(getRouteNode(src, 'nestedPage'), fakeRouter)

    expect(route.isPrivate).toBe(true)
    expect(route.roles).toBeInstanceOf(Array)
    expect(route.roles).toHaveLength(3)
    expect(route.roles).toContain('admin')
    expect(route.roles).toContain('owner')
    expect(route.roles).toContain('superuser')
  })

  it('keeps single-wrapper roles as an array when only that ancestor has roles', () => {
    const src = `
      const Routes = () => (
        <Router>
          <PrivateSet unauthenticated="home" roles={['owner', 'superuser']}>
            <Route path="/private" page={PrivatePage} name="privatePage" />
          </PrivateSet>
        </Router>
      )
    `
    const route = new RWRoute(getRouteNode(src, 'privatePage'), fakeRouter)

    expect(route.isPrivate).toBe(true)
    expect(route.roles).toBeInstanceOf(Array)
    expect(route.roles).toContain('owner')
    expect(route.roles).toContain('superuser')
  })
})
