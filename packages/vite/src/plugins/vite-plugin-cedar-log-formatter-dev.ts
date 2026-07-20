import type { Plugin } from 'vite'

const INTERCEPTED_SPECIFIER = '@cedarjs/api/logger'
const VIRTUAL_MODULE_ID = 'virtual:cedar-api-logger-dev'
const RESOLVED_VIRTUAL_MODULE_ID = '\0' + VIRTUAL_MODULE_ID

/**
 * Dev-only Vite plugin that makes the api's pino logger pretty-print
 * through the same formatter plain `yarn cedar dev` gets via its
 * `... | cedar-log-formatter` shell pipe.
 *
 * `--ud` mode runs the api in-process as Vite SSR middleware, so there's no
 * separate api process whose stdout a shell pipe could format externally,
 * and pino's default destination writes straight to file descriptor 1
 * (bypassing `process.stdout.write`), so patching stdout wouldn't see the
 * log lines either. Instead, this intercepts resolution of
 * `@cedarjs/api/logger` and swaps in a wrapped `createLogger` that injects
 * a formatting `destination` whenever the caller (the app's own
 * `api/src/lib/logger.ts`) doesn't already supply one.
 *
 * Only registered in `createApiViteServer()`'s dev-only Vite instance —
 * never touched by any production build path — so this has no effect on
 * (and no dependency footprint added to) a deployed api.
 */
export function cedarApiLogFormatterDevPlugin(): Plugin {
  return {
    name: 'cedar-api-log-formatter-dev',
    enforce: 'pre',
    resolveId(id, importer) {
      // The virtual module's own `import ... from '@cedarjs/api/logger'`
      // below must fall through to Vite's normal resolution (the real
      // package) rather than being redirected back here, or this recurses
      // forever.
      if (
        id === INTERCEPTED_SPECIFIER &&
        importer !== RESOLVED_VIRTUAL_MODULE_ID
      ) {
        return RESOLVED_VIRTUAL_MODULE_ID
      }

      return null
    },
    load(id) {
      if (id !== RESOLVED_VIRTUAL_MODULE_ID) {
        return null
      }

      return `
import * as realLogger from ${JSON.stringify(INTERCEPTED_SPECIFIER)}
import { LogFormatter } from '@cedarjs/api-server/logFormatter'

export * from ${JSON.stringify(INTERCEPTED_SPECIFIER)}

function createFormattingDestination() {
  const format = LogFormatter()
  let buffered = ''

  return {
    write(chunk) {
      buffered += chunk
      const lines = buffered.split('\\n')
      buffered = lines.pop() ?? ''

      for (const line of lines) {
        if (line.length > 0) {
          process.stdout.write(format(line))
        }
      }
    },
  }
}

export function createLogger(params = {}) {
  if (params.destination) {
    return realLogger.createLogger(params)
  }

  return realLogger.createLogger({
    ...params,
    destination: createFormattingDestination(),
  })
}
`
    },
  }
}
