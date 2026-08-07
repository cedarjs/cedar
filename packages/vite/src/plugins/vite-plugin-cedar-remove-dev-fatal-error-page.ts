import type { Plugin, ResolvedConfig } from 'vite'

const DEV_FATAL_ERROR_PAGE_MODULE =
  '@cedarjs/web/dist/components/DevFatalErrorPage'

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const ESCAPED_MODULE = escapeRegExp(DEV_FATAL_ERROR_PAGE_MODULE)
const IMPORT_PATTERN = new RegExp(
  `import\\s*\\{[^}]*\\bDevFatalErrorPage\\b[^}]*\\}\\s*from\\s*['"]${ESCAPED_MODULE}['"]`,
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
  let config: ResolvedConfig

  return {
    name: 'cedar-remove-dev-fatal-error-page',
    apply: 'build',
    configResolved(resolvedConfig) {
      config = resolvedConfig
    },
    transform(code) {
      // Skip transformation if not in production
      if (config.command === 'build' && config.mode === 'development') {
        return null
      }

      if (!code.includes(DEV_FATAL_ERROR_PAGE_MODULE)) {
        return null
      }

      const newCode = code.replace(
        IMPORT_PATTERN,
        'const DevFatalErrorPage = undefined',
      )

      // Only return a result if the code actually changed
      if (newCode === code) {
        return null
      }

      return { code: newCode, map: null }
    },
  }
}
