import { useSyncExternalStore } from 'react'

export interface UseNewVersionAvailableOptions {
  /**
   * URL of the app's HTML document to check for a new version.
   *
   * @default '/'
   */
  url?: string
  /**
   * How often to check for a new version, in milliseconds.
   *
   * @default 60000
   */
  intervalMs?: number
}

interface VersionChecker {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => boolean
}

const DEFAULT_URL = '/'
const DEFAULT_INTERVAL_MS = 60_000

/**
 * Pathnames of the module scripts in the document that is running in this
 * tab. Captured the first time the hook runs on the client, which is before
 * any newer build could have been loaded into the tab.
 */
let runningModuleScripts: Set<string> | undefined

/**
 * One checker per url + interval combination, shared by every component that
 * uses the hook with those options, so there is only ever one polling loop for
 * each combination.
 */
const checkers = new Map<string, VersionChecker>()

function getModuleScriptPathnames(doc: Document, baseUrl: string) {
  const pathnames = new Set<string>()

  doc.querySelectorAll('script[type="module"][src]').forEach((script) => {
    const src = script.getAttribute('src')

    if (!src) {
      return
    }

    try {
      pathnames.add(new URL(src, baseUrl).pathname)
    } catch {
      // Unparsable `src` values can't identify a build, so they're skipped
    }
  })

  return pathnames
}

function setsAreEqual(a: Set<string>, b: Set<string>) {
  if (a.size !== b.size) {
    return false
  }

  for (const value of a) {
    if (!b.has(value)) {
      return false
    }
  }

  return true
}

function createVersionChecker(
  url: string,
  intervalMs: number,
  runningScripts: Set<string>,
): VersionChecker {
  const listeners = new Set<() => void>()
  let newVersionAvailable = false
  let checkInFlight = false
  let intervalId: ReturnType<typeof setInterval> | undefined

  const notify = () => {
    listeners.forEach((listener) => listener())
  }

  const check = async () => {
    if (newVersionAvailable || checkInFlight) {
      return
    }

    checkInFlight = true

    try {
      const requestUrl = new URL(url, document.baseURI).href

      // `credentials: 'omit'` keeps cookies off the request. Hosts with skew
      // protection (like Netlify) pin requests that carry a deploy cookie to
      // the deploy the tab was loaded from, which would hide new deploys
      const response = await fetch(requestUrl, {
        cache: 'no-store',
        credentials: 'omit',
      })

      if (!response.ok) {
        return
      }

      const html = await response.text()
      const fetchedDocument = new DOMParser().parseFromString(html, 'text/html')
      const fetchedScripts = getModuleScriptPathnames(
        fetchedDocument,
        response.url || requestUrl,
      )

      // A document without module scripts (an error page, a captive portal
      // etc.) says nothing about which build is deployed
      if (fetchedScripts.size === 0) {
        return
      }

      if (!setsAreEqual(runningScripts, fetchedScripts)) {
        newVersionAvailable = true
        stop()
        notify()
      }
    } catch {
      // Network errors are expected (offline, flaky connections). The next
      // check tries again
    } finally {
      checkInFlight = false
    }
  }

  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      void check()
    }
  }

  const onOnline = () => {
    void check()
  }

  function start() {
    intervalId = setInterval(() => void check(), intervalMs)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('online', onOnline)
  }

  function stop() {
    if (intervalId !== undefined) {
      clearInterval(intervalId)
      intervalId = undefined
    }

    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('online', onOnline)
  }

  return {
    subscribe: (listener) => {
      listeners.add(listener)

      if (listeners.size === 1 && !newVersionAvailable) {
        start()
      }

      return () => {
        listeners.delete(listener)

        if (listeners.size === 0) {
          stop()
        }
      }
    },
    getSnapshot: () => newVersionAvailable,
  }
}

function getVersionChecker(url: string, intervalMs: number) {
  // Nothing to check on the server (SSR, prerendering)
  if (typeof window === 'undefined') {
    return undefined
  }

  // Vite's dev server serves unhashed entry files, so the HTML never changes
  // between edits
  if (process.env.NODE_ENV === 'development') {
    return undefined
  }

  runningModuleScripts ??= getModuleScriptPathnames(document, document.baseURI)

  // Without module scripts there's nothing that identifies the running build
  if (runningModuleScripts.size === 0) {
    return undefined
  }

  const key = `${intervalMs}:${url}`
  let checker = checkers.get(key)

  if (!checker) {
    checker = createVersionChecker(url, intervalMs, runningModuleScripts)
    checkers.set(key, checker)
  }

  return checker
}

const subscribeNoop = () => () => {}
const getFalse = () => false

/**
 * Detects that the server is serving a newer build of the app than the one
 * running in the current tab, so you can ask the user to reload.
 *
 * The running build is identified by the `<script type="module" src="...">`
 * elements in the current document, which Vite gives content-hashed file
 * names. The hook periodically fetches the app's HTML (and also checks when
 * the tab becomes visible again or the browser comes back online) and
 * compares its module scripts with the running ones. Once a new version is
 * detected the hook returns `true` and stops checking.
 *
 * The hook always returns `false` during server rendering, in development
 * and when the current document has no module scripts.
 *
 * Components using the hook with the same options share a single polling
 * loop.
 *
 * @example
 * ```jsx
 * import { useNewVersionAvailable } from '@cedarjs/web'
 *
 * const NewVersionBanner = () => {
 *   const newVersionAvailable = useNewVersionAvailable()
 *
 *   if (!newVersionAvailable) {
 *     return null
 *   }
 *
 *   return (
 *     <div role="status">
 *       A new version of the app is available.
 *       <button onClick={() => window.location.reload()}>Reload</button>
 *     </div>
 *   )
 * }
 * ```
 */
export function useNewVersionAvailable(
  options: UseNewVersionAvailableOptions = {},
): boolean {
  const url = options.url ?? DEFAULT_URL
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
  const checker = getVersionChecker(url, intervalMs)

  return useSyncExternalStore(
    checker?.subscribe ?? subscribeNoop,
    checker?.getSnapshot ?? getFalse,
    getFalse,
  )
}
