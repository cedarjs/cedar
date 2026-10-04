/**
 * `sessionStorage` key that marks the next page load as one triggered by the
 * `vite:preloadError` handler
 */
export const PRELOAD_ERROR_RELOAD_KEY = 'cedar:preload-error-reload'

/**
 * On a page that the handler itself reloaded, a preload error within this many
 * milliseconds of the page starting to load is left for the app to handle. A
 * chunk that is missing even on the latest deploy then surfaces as an error
 * instead of causing a reload loop, no matter how long each attempt takes to
 * fail. After this long, the page is treated like any other, so a later deploy
 * can reload it again.
 */
export const RELOADED_PAGE_GRACE_MS = 60_000

let pageWasReloadedForPreloadError = false

/**
 * Reads and clears the marker the handler sets before reloading, so the new
 * page knows whether it is the result of that reload
 */
function consumeReloadMarker() {
  try {
    pageWasReloadedForPreloadError =
      window.sessionStorage.getItem(PRELOAD_ERROR_RELOAD_KEY) !== null
    window.sessionStorage.removeItem(PRELOAD_ERROR_RELOAD_KEY)
  } catch {
    pageWasReloadedForPreloadError = false
  }
}

function setReloadMarker() {
  try {
    window.sessionStorage.setItem(PRELOAD_ERROR_RELOAD_KEY, '1')
    return true
  } catch {
    return false
  }
}

/**
 * Handles Vite's `vite:preloadError` event, which fires when a dynamically
 * imported chunk fails to load. After a new deploy, a tab running the
 * previous build requests hashed chunks that no longer exist on the server.
 * Reloading the page fetches the latest build so the navigation can succeed.
 *
 * The handler does nothing if the event was already handled
 * (`defaultPrevented`), if this page is the result of the handler's own
 * reload and started loading less than `RELOADED_PAGE_GRACE_MS` ago, or if
 * `sessionStorage` is unavailable (without it, a reload loop can't be ruled
 * out). In those cases Vite rethrows the error and it surfaces through the
 * app's normal error handling.
 *
 * See https://vite.dev/guide/build#load-error-handling
 */
export function handlePreloadError(event: Event) {
  if (event.defaultPrevented) {
    return
  }

  if (
    pageWasReloadedForPreloadError &&
    performance.now() < RELOADED_PAGE_GRACE_MS
  ) {
    return
  }

  if (!setReloadMarker()) {
    return
  }

  event.preventDefault()
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
  consumeReloadMarker()
  window.addEventListener('vite:preloadError', handlePreloadError)
}
