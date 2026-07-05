import type { Plugin } from 'vite'

const DEV_FATAL_ERROR_PAGE_MODULE =
  '@cedarjs/web/dist/components/DevFatalErrorPage'

const IMPORT_PATTERN = new RegExp(
  `import\\s*\\{[^}]*\\bDevFatalErrorPage\\b[^}]*\\}\\s*from\\s*['"]${DEV_FATAL_ERROR_PAGE_MODULE.replace(/\//g, '\\/')}['"]`,
)

/**
 * Vite plugin to remove the DevFatalErrorPage import in production builds.
 *
 * Replaces:
 *   import { DevFatalErrorPage } from '@cedarjs/web/dist/components/DevFatalErrorPage'
 * with:
 *   const DevFatalErrorPage = undefined
 *
 * This ensures the DevFatalErrorPage component is not shipped in the
 * production bundle. In development, the import is kept so the page
 * renders when an unhandled error bubbles to the top of the app.
 */
export function cedarRemoveDevFatalErrorPage(): Plugin {
  return {
    name: 'cedar-remove-dev-fatal-error-page',
    apply: 'build',
    transform(code) {
      if (!code.includes(DEV_FATAL_ERROR_PAGE_MODULE)) {
        return null
      }

      const newCode = code.replace(
        IMPORT_PATTERN,
        'const DevFatalErrorPage = undefined',
      )

      return { code: newCode }
    },
  }
}
