import type { PluginOption } from 'vite'

/**
 * Replace `@cedarjs/router` imports with imports of
 * `@cedarjs/testing/web/MockRouter.js` instead
 */
export function cedarJsRouterImportTransformPlugin(): PluginOption {
  return {
    name: 'cedarjs-router-import-transform',
    enforce: 'pre',
    transform(code: string, id: string) {
      console.log('cedarjs-router-import-transform id', id)

      if (id.includes('/web/src')) {
        code = code.replace(
          /['"]@cedarjs\/router['"]/,
          "'@cedarjs/testing/web/MockRouter.js'",
        )

        console.log('cedarjs-router-import-transform code', code)
      }

      return code
    },
  }
}
