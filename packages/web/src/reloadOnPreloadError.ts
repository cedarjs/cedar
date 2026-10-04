/**
 * `sessionStorage` key holding the timestamp (ms since epoch) of the last
 * reload triggered by the `vite:preloadError` handler
 */
export const PRELOAD_ERROR_RELOAD_KEY = 'cedar:preload-error-reload-at'

/**
 * A second preload error within this many milliseconds of a handler-triggered
 * reload is left for the app to handle, so a chunk that is missing even on the
 * latest deploy doesn't cause an endless reload loop
 */
export const PRELOAD_ERROR_RELOAD_WINDOW_MS = 10_000

function readLastReloadAt(): number | undefined {
  try {
    const value = window.sessionStorage.getItem(PRELOAD_ERROR_RELOAD_KEY)
    const timestamp = value === null ? NaN : Number(value)

    return Number.isFinite(timestamp) ? timestamp : undefined
  } catch {
    return undefined
  }
}

function writeLastReloadAt(timestamp: number) {
  try {
    window.sessionStorage.setItem(PRELOAD_ERROR_RELOAD_KEY, String(timestamp))
  } catch {
    // Storage can be unavailable (privacy settings, quota, sandboxed iframes).
    // The reload still happens, just without loop protection.
  }
}

/**
 * Handles Vite's `vite:preloadError` event, which fires when a dynamically
 * imported chunk fails to load. After a new deploy, a tab running the
 * previous build requests hashed chunks that no longer exist on the server.
 * Reloading the page fetches the latest build so the navigation can succeed.
 *
 * The handler does nothing if the event was already handled
 * (`defaultPrevented`), or if it triggered a reload within the last
 * `PRELOAD_ERROR_RELOAD_WINDOW_MS`. In those cases Vite rethrows the error and
 * it surfaces through the app's normal error handling.
 *
 * See https://vite.dev/guide/build#load-error-handling
 */
export function handlePreloadError(event: Event) {
  if (event.defaultPrevented) {
    return
  }

  const now = Date.now()
  const lastReloadAt = readLastReloadAt()

  if (
    lastReloadAt !== undefined &&
    now - lastReloadAt >= 0 &&
    now - lastReloadAt < PRELOAD_ERROR_RELOAD_WINDOW_MS
  ) {
    return
  }

  event.preventDefault()
  writeLastReloadAt(now)
  window.location.reload()
}

/**
 * Registers `handlePreloadError` as a `vite:preloadError` listener on
 * `window`. Runs at most once per page load, and does nothing outside the
 * browser.
 */
export function registerPreloadErrorReload() {
  if (typeof window === 'undefined') {
    return
  }

  if (globalThis.__CEDAR__PRELOAD_ERROR_RELOAD_REGISTERED) {
    return
  }

  globalThis.__CEDAR__PRELOAD_ERROR_RELOAD_REGISTERED = true
  window.addEventListener('vite:preloadError', handlePreloadError)
}
