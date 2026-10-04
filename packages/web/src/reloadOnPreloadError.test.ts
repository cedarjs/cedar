import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  PRELOAD_ERROR_RELOAD_KEY,
  RELOADED_PAGE_GRACE_MS,
  handlePreloadError,
  registerPreloadErrorReload,
} from './reloadOnPreloadError.js'

const originalLocation = window.location
const reload = vi.fn()

function dispatchPreloadError() {
  const event = new Event('vite:preloadError', { cancelable: true })
  window.dispatchEvent(event)

  return event
}

/**
 * Simulates a fresh page load: the module registers its listener again, as
 * it would when `@cedarjs/web` is evaluated on the new page
 */
function loadPage() {
  window.removeEventListener('vite:preloadError', handlePreloadError)
  globalThis.__CEDAR__PRELOAD_ERROR_RELOAD_REGISTERED = undefined
  registerPreloadErrorReload()
}

/** Sets how long ago (in ms) the current page started loading */
function setPageAge(ms: number) {
  vi.spyOn(performance, 'now').mockReturnValue(ms)
}

describe('reloadOnPreloadError', () => {
  beforeEach(() => {
    reload.mockReset()
    // jsdom does not implement navigation, so `location.reload` is replaced
    // with a spy for the duration of each test
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, reload },
    })

    window.sessionStorage.clear()
    setPageAge(1_000)
    loadPage()
  })

  afterEach(() => {
    window.removeEventListener('vite:preloadError', handlePreloadError)
    globalThis.__CEDAR__PRELOAD_ERROR_RELOAD_REGISTERED = undefined

    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    })

    vi.restoreAllMocks()
  })

  it('reloads the page on a preload error', () => {
    const event = dispatchPreloadError()

    expect(reload).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
    expect(window.sessionStorage.getItem(PRELOAD_ERROR_RELOAD_KEY)).toBe('1')
  })

  it('clears the reload marker when the reloaded page loads', () => {
    dispatchPreloadError()
    loadPage()

    expect(window.sessionStorage.getItem(PRELOAD_ERROR_RELOAD_KEY)).toBeNull()
  })

  it('does not reload again when the reloaded page fails too', () => {
    dispatchPreloadError()
    loadPage()

    const event = dispatchPreloadError()

    expect(reload).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(false)
  })

  it('does not reload again when the reloaded page is slow to fail', () => {
    dispatchPreloadError()
    loadPage()
    setPageAge(RELOADED_PAGE_GRACE_MS - 1)

    dispatchPreloadError()

    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('reloads a reloaded page again once it has been open for a while', () => {
    dispatchPreloadError()
    loadPage()
    setPageAge(RELOADED_PAGE_GRACE_MS)

    const event = dispatchPreloadError()

    expect(reload).toHaveBeenCalledTimes(2)
    expect(event.defaultPrevented).toBe(true)
  })

  it('reloads on every page load that Cedar did not reload itself', () => {
    dispatchPreloadError()
    loadPage()
    // A later navigation, e.g. the user following a link, loads another page
    loadPage()

    dispatchPreloadError()

    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('does not reload when sessionStorage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    loadPage()

    const event = dispatchPreloadError()

    expect(reload).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('does not reload when the reload marker cannot be written', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    const event = dispatchPreloadError()

    expect(reload).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('ignores events that were already handled', () => {
    const event = new Event('vite:preloadError', { cancelable: true })
    event.preventDefault()

    handlePreloadError(event)

    expect(reload).not.toHaveBeenCalled()
  })

  it('registers the listener only once', () => {
    const addEventListener = vi.spyOn(window, 'addEventListener')

    registerPreloadErrorReload()
    registerPreloadErrorReload()

    expect(addEventListener).not.toHaveBeenCalled()
  })
})
