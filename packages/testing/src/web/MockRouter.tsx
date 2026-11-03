// For Vitest we use a plugin to swap out imports from `@cedarjs/router` to this
// file. @see ./vitest/vite-plugin-cedarjs-router-import-transform.ts
//
// It's therefore important to reexport everything that we *don't* want to mock.

import type React from 'react'

import { flattenAll } from '@cedarjs/router/dist/react-util'
// Bypass the `main` field in `package.json` because we alias `@cedarjs/router`
// for Vitest and Storybook. Not doing so would cause an infinite loop.
import { isValidRoute } from '@cedarjs/router/dist/route-validators'
import type { RouterProps } from '@cedarjs/router/dist/router'
import type { Tenancy } from '@cedarjs/router/dist/router-context'
import { replaceParams } from '@cedarjs/router/dist/util'

import { mockedTenancyMeta } from './mockTenancy.js'

export * from '@cedarjs/router/dist/index'

export const routes: { [routeName: string]: () => string } = {}

/**
 * The props this router reads. In an app without tenancy `RouterProps` has no
 * `tenancy`, but this file is compiled as one, so it reads it through this
 * type, which `RouterProps` always fits.
 */
interface MockRouterProps extends RouterProps {
  tenancy?: Tenancy
}

/**
 * This router populates the `routes.<pageName>()` utility object, and records
 * the app's `tenancy` for `MockOrgProvider`.
 */
const MockRouter: React.FC<MockRouterProps> = ({ tenancy, children }) => {
  mockedTenancyMeta.tenancy = tenancy

  const flatChildArray = flattenAll(children)

  flatChildArray.forEach((child) => {
    if (isValidRoute(child)) {
      const { name, path } = child.props

      if (name && path) {
        routes[name] = (args = {}) => replaceParams(path, args)
      }
    }
  })

  return null
}

export const Router: React.FC<RouterProps> = MockRouter
