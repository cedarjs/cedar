import type { Plugin as RollupPlugin } from 'rollup'

const DEV_FATAL_ERROR_PAGE_MODULE =
  '@cedarjs/web/dist/components/DevFatalErrorPage'

const IMPORT_PATTERN = new RegExp(
  `import\\s*\\{[^}]*\\bDevFatalErrorPage\\b[^}]*\\}\\s*from\\s*['"]${DEV_FATAL_ERROR_PAGE_MODULE.replace(/\//g, '\\/')}['"]`,
)

/**
 * Rollup plugin to remove the DevFatalErrorPage import during prerendering.
 *
 * Replaces:
 *   import { DevFatalErrorPage } from '@cedarjs/web/dist/components/DevFatalErrorPage'
 * with:
 *   const DevFatalErrorPage = undefined
 *
 * Prerendering runs in a production context and should not include the
 * dev-only error page component in the bundle.
 */
export const cedarRemoveDevFatalErrorPagePlugin = (): RollupPlugin => {
  return {
    name: 'cedar-remove-dev-fatal-error-page',
    transform(code) {
      if (!code.includes(DEV_FATAL_ERROR_PAGE_MODULE)) {
        return null
      }

      const newCode = code.replace(
        IMPORT_PATTERN,
        'const DevFatalErrorPage = undefined',
      )

      return { code: newCode, map: null }
    },
  }
}
