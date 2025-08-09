import type React from 'react'

import { flattenAll } from '@cedarjs/router/dist/react-util'
// Bypass the `main` field in `package.json` because we alias `@cedarjs/router`
// for jest and Storybook. Not doing so would cause an infinite loop.
// See: ./packages/testing/config/jest/web/jest-preset.js
import { isValidRoute } from '@cedarjs/router/dist/route-validators'
import type { RouterProps } from '@cedarjs/router/dist/router'
import { replaceParams } from '@cedarjs/router/dist/util'
export * from '@cedarjs/router/dist/index'

export const routes: { [routeName: string]: () => string } = {}

/**
 * We overwrite the default `Router` export (see jest-preset). So every import
 * of @cedarjs/router will import this Router instead
 *
 * This router populates the `routes.<pageName>()` utility object.
 */
export const Router: React.FC<RouterProps> = ({ children }) => {
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
