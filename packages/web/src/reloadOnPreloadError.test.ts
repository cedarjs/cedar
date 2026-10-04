import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  PRELOAD_ERROR_RELOAD_KEY,
  PRELOAD_ERROR_RELOAD_WINDOW_MS,
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

describe('reloadOnPreloadError', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))

    reload.mockReset()
    // jsdom does not implement navigation, so `location.reload` is replaced
    // with a spy for the duration of each test
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, reload },
    })

    window.sessionStorage.clear()
    globalThis.__CEDAR__PRELOAD_ERROR_RELOAD_REGISTERED = undefined
    registerPreloadErrorReload()
  })

  afterEach(() => {
    window.removeEventListener('vite:preloadError', handlePreloadError)
    globalThis.__CEDAR__PRELOAD_ERROR_RELOAD_REGISTERED = undefined

    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    })

    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('reloads the page on the first preload error', () => {
    const event = dispatchPreloadError()

    expect(reload).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
    expect(window.sessionStorage.getItem(PRELOAD_ERROR_RELOAD_KEY)).toBe(
      String(Date.now()),
    )
  })

  it('does not reload again within the reload window', () => {
    dispatchPreloadError()
    expect(reload).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(PRELOAD_ERROR_RELOAD_WINDOW_MS - 1)
    const secondEvent = dispatchPreloadError()

    expect(reload).toHaveBeenCalledTimes(1)
    expect(secondEvent.defaultPrevented).toBe(false)
  })

  it('reloads again once the reload window has passed', () => {
    dispatchPreloadError()
    expect(reload).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(PRELOAD_ERROR_RELOAD_WINDOW_MS)
    const secondEvent = dispatchPreloadError()

    expect(reload).toHaveBeenCalledTimes(2)
    expect(secondEvent.defaultPrevented).toBe(true)
  })

  it('still reloads when sessionStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    const event = dispatchPreloadError()

    expect(reload).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
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
