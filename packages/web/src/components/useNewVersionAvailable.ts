import { useSyncExternalStore } from 'react'

export interface UseNewVersionAvailableOptions {
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

const DEFAULT_INTERVAL_MS = 60_000

/**
 * A check that hasn't settled after this long is aborted, so a stalled
 * request can't block later checks. Checks that are due while one is still
 * running are skipped, so slow responses still complete.
 */
const CHECK_TIMEOUT_MS = 30_000

/**
 * The URL this tab's document was loaded from, captured when `@cedarjs/web`
 * is first evaluated, before any client-side navigation. Within one build,
 * the same URL always serves the same module scripts: prerendered pages and
 * server-rendered routes add a page-specific chunk next to the app entry, so
 * different URLs can serve different scripts even when nothing was deployed.
 */
const initialDocumentUrl =
  typeof document === 'undefined' ? undefined : document.URL

/**
 * Pathnames of the module scripts in the document that is running in this
 * tab. Captured the first time the hook runs on the client, which is before
 * any newer build could have been loaded into the tab.
 */
let runningModuleScripts: Set<string> | undefined

/**
 * One checker per interval, shared by every component that uses the hook
 * with that interval, so there is only ever one polling loop for each.
 */
const checkers = new Map<number, VersionChecker>()

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
  lifecycle: { onActive: () => void; onIdle: () => void },
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

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS)

    try {
      const requestUrl = new URL(url)
      requestUrl.hash = ''

      // `credentials: 'omit'` keeps cookies off the request. Hosts with skew
      // protection (like Netlify) pin requests that carry a deploy cookie to
      // the deploy the tab was loaded from, which would hide new deploys
      const response = await fetch(requestUrl.href, {
        cache: 'no-store',
        credentials: 'omit',
        signal: controller.signal,
      })

      // A redirect (e.g. to a login page) serves a different page, whose
      // scripts can't be compared with the running ones
      if (response.redirected) {
        return
      }

      const html = await response.text()
      const fetchedDocument = new DOMParser().parseFromString(html, 'text/html')
      const fetchedScripts = getModuleScriptPathnames(
        fetchedDocument,
        response.url || requestUrl.href,
      )

      // A document without module scripts (a host's error page, a captive
      // portal etc.) says nothing about which build is deployed. The status
      // code isn't checked: a page the app renders with an error status (its
      // 404 page, for example) still identifies the build
      if (fetchedScripts.size === 0) {
        return
      }

      if (!setsAreEqual(runningScripts, fetchedScripts)) {
        newVersionAvailable = true
        stop()
        notify()
      }
    } catch {
      // Network errors and timeouts are expected (offline, flaky
      // connections). The next check tries again
    } finally {
      clearTimeout(timeoutId)
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

      if (listeners.size === 1) {
        lifecycle.onActive()

        if (!newVersionAvailable) {
          start()
        }
      }

      return () => {
        listeners.delete(listener)

        if (listeners.size === 0) {
          stop()
          lifecycle.onIdle()
        }
      }
    },
    getSnapshot: () => newVersionAvailable,
  }
}

function getVersionChecker(intervalMs: number) {
  // Nothing to check on the server (SSR, prerendering)
  if (typeof window === 'undefined' || !initialDocumentUrl) {
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

  const existingChecker = checkers.get(intervalMs)

  if (existingChecker) {
    return existingChecker
  }

  const checker: VersionChecker = createVersionChecker(
    initialDocumentUrl,
    intervalMs,
    runningModuleScripts,
    {
      onActive: () => {
        checkers.set(intervalMs, checker)
      },
      // A checker that found a new version is kept, so components mounting
      // later see `true` right away. Idle checkers are dropped, so intervals
      // that are no longer used don't accumulate
      onIdle: () => {
        if (!checker.getSnapshot()) {
          checkers.delete(intervalMs)
        }
      },
    },
  )
  checkers.set(intervalMs, checker)

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
 * names. The hook periodically fetches the URL the tab was loaded from (and
 * also checks when the tab becomes visible again or the browser comes back
 * online) and compares the module scripts in the response with the running
 * ones. The request is sent without cookies, so hosts with skew protection
 * (like Netlify) answer with the latest deploy. Once a new version is
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
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
  const checker = getVersionChecker(intervalMs)

  return useSyncExternalStore(
    checker?.subscribe ?? subscribeNoop,
    checker?.getSnapshot ?? getFalse,
    getFalse,
  )
}
