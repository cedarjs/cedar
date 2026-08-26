import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { getRouteHookDistPath } from '../buildRouteHooks.js'

const webSrc = path.join('/proj', 'web', 'src')

describe('getRouteHookDistPath', () => {
  it('mirrors the web/src layout for page route hooks', () => {
    const src = path.join(webSrc, 'pages', 'HomePage', 'HomePage.routeHooks.ts')

    expect(getRouteHookDistPath(src, webSrc)).toBe(
      'pages/HomePage/HomePage.routeHooks.js',
    )
  })

  it('puts the App route hook at the top level', () => {
    const src = path.join(webSrc, 'App.routeHooks.tsx')

    expect(getRouteHookDistPath(src, webSrc)).toBe('App.routeHooks.js')
  })

  it('only rewrites the file extension', () => {
    const src = path.join(webSrc, 'pages', 'ts.js', 'ts.js.routeHooks.jsx')

    expect(getRouteHookDistPath(src, webSrc)).toBe(
      'pages/ts.js/ts.js.routeHooks.js',
    )
  })
})
