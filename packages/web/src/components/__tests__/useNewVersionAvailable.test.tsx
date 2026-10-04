import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { useNewVersionAvailable as UseNewVersionAvailable } from '../useNewVersionAvailable.js'

const RUNNING_ENTRY = '/assets/index-OLD123.js'

const htmlWithScripts = (...srcs: string[]) =>
  `<!doctype html><html><head>${srcs
    .map((src) => `<script type="module" src="${src}"></script>`)
    .join('')}</head><body></body></html>`

const htmlWithEntry = (src: string) => htmlWithScripts(src)

const htmlResponse = (html: string, status = 200) =>
  new Response(html, { status, headers: { 'Content-Type': 'text/html' } })

const fetchMock = vi.fn<typeof fetch>()

let useNewVersionAvailable: typeof UseNewVersionAvailable

/**
 * The hook keeps module-level state (the running build's scripts and the
 * shared checkers), so every test gets a fresh copy of the module, imported
 * after the test document has been set up
 */
async function loadHook() {
  vi.resetModules()
  const mod = await import('../useNewVersionAvailable.js')
  useNewVersionAvailable = mod.useNewVersionAvailable
}

function setRunningScripts(...srcs: string[]) {
  document.head.innerHTML = srcs
    .map((src) => `<script type="module" src="${src}"></script>`)
    .join('')
}

function setRunningEntry(src: string | undefined) {
  if (src) {
    setRunningScripts(src)
  } else {
    setRunningScripts()
  }
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  })
}

describe('useNewVersionAvailable', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    setVisibility('visible')
    setRunningEntry(RUNNING_ENTRY)
    await loadHook()
  })

  afterEach(() => {
    window.history.replaceState(null, '', '/')
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    document.head.innerHTML = ''
  })

  it('returns false initially', () => {
    const { result } = renderHook(() => useNewVersionAvailable())

    expect(result.current).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns true after the server serves a different entry', async () => {
    fetchMock.mockResolvedValue(
      htmlResponse(htmlWithEntry('/assets/index-NEW456.js')),
    )

    const { result } = renderHook(() => useNewVersionAvailable())
    await advance(60_000)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.current).toBe(true)
  })

  it('stays false when the server serves the same entry', async () => {
    fetchMock.mockImplementation(async () =>
      htmlResponse(htmlWithEntry(RUNNING_ENTRY)),
    )

    const { result } = renderHook(() => useNewVersionAvailable())
    await advance(60_000)
    await advance(60_000)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.current).toBe(false)
  })

  it('treats a relative entry resolving to the same path as the same build', async () => {
    fetchMock.mockResolvedValue(
      htmlResponse(htmlWithEntry('assets/index-OLD123.js')),
    )

    const { result } = renderHook(() => useNewVersionAvailable())
    await advance(60_000)

    expect(result.current).toBe(false)
  })

  it('ignores fetch rejections and tries again next time', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(
        htmlResponse(htmlWithEntry('/assets/index-NEW456.js')),
      )

    const { result } = renderHook(() => useNewVersionAvailable())
    await advance(60_000)

    expect(result.current).toBe(false)

    await advance(60_000)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.current).toBe(true)
  })

  it('compares pages the app renders with an error status', async () => {
    fetchMock.mockImplementation(async () =>
      htmlResponse(htmlWithEntry('/assets/index-NEW456.js'), 404),
    )

    const { result } = renderHook(() => useNewVersionAvailable())
    await advance(60_000)

    expect(result.current).toBe(true)
  })

  it('ignores redirected responses', async () => {
    fetchMock.mockImplementation(async () => {
      const response = htmlResponse(htmlWithEntry('/assets/index-NEW456.js'))
      Object.defineProperty(response, 'redirected', { value: true })

      return response
    })

    const { result } = renderHook(() => useNewVersionAvailable())
    await advance(60_000)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.current).toBe(false)
  })

  it('stays false for an unchanged page with a page-specific chunk', async () => {
    // Prerendered pages and server-rendered routes add a chunk for the page
    // next to the app entry
    setRunningScripts('/assets/AboutPage-ABC.js', RUNNING_ENTRY)
    await loadHook()
    fetchMock.mockImplementation(async () =>
      htmlResponse(htmlWithScripts('/assets/AboutPage-ABC.js', RUNNING_ENTRY)),
    )

    const { result } = renderHook(() => useNewVersionAvailable())
    await advance(60_000)

    expect(result.current).toBe(false)
  })

  it('returns true when a page with a page-specific chunk was redeployed', async () => {
    setRunningScripts('/assets/AboutPage-ABC.js', RUNNING_ENTRY)
    await loadHook()
    fetchMock.mockImplementation(async () =>
      htmlResponse(
        htmlWithScripts('/assets/AboutPage-ABC.js', '/assets/index-NEW456.js'),
      ),
    )

    const { result } = renderHook(() => useNewVersionAvailable())
    await advance(60_000)

    expect(result.current).toBe(true)
  })

  it('ignores HTML without module scripts', async () => {
    fetchMock.mockImplementation(async () =>
      htmlResponse('<!doctype html><html><body>Oops</body></html>'),
    )

    const { result } = renderHook(() => useNewVersionAvailable())
    await advance(60_000)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.current).toBe(false)
  })

  it('checks when the tab becomes visible again', async () => {
    fetchMock.mockResolvedValue(
      htmlResponse(htmlWithEntry('/assets/index-NEW456.js')),
    )

    const { result } = renderHook(() => useNewVersionAvailable())

    setVisibility('hidden')
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(fetchMock).not.toHaveBeenCalled()

    setVisibility('visible')
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await advance(0)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.current).toBe(true)
  })

  it('checks when the browser comes back online', async () => {
    fetchMock.mockResolvedValue(
      htmlResponse(htmlWithEntry('/assets/index-NEW456.js')),
    )

    const { result } = renderHook(() => useNewVersionAvailable())

    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })
    await advance(0)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.current).toBe(true)
  })

  it('fetches the URL the tab was loaded from, without the cache or cookies', async () => {
    window.history.replaceState(null, '', '/about?tab=team#history')
    await loadHook()
    // A client-side navigation after the page loaded doesn't change what's
    // fetched
    window.history.pushState(null, '', '/contact')
    fetchMock.mockImplementation(async () =>
      htmlResponse(htmlWithEntry(RUNNING_ENTRY)),
    )

    renderHook(() => useNewVersionAvailable())
    await advance(60_000)

    expect(fetchMock).toHaveBeenCalledWith(
      new URL('/about?tab=team', document.baseURI).href,
      expect.objectContaining({ cache: 'no-store', credentials: 'omit' }),
    )
  })

  it('recovers when a check never settles', async () => {
    fetchMock
      .mockImplementationOnce(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(init.signal?.reason),
            )
          }),
      )
      .mockResolvedValue(htmlResponse(htmlWithEntry('/assets/index-NEW456.js')))

    const { result } = renderHook(() => useNewVersionAvailable())
    await advance(60_000)

    expect(result.current).toBe(false)

    await advance(60_000)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.current).toBe(true)
  })

  it('respects a custom interval', async () => {
    fetchMock.mockImplementation(async () =>
      htmlResponse(htmlWithEntry(RUNNING_ENTRY)),
    )

    renderHook(() => useNewVersionAvailable({ intervalMs: 5_000 }))
    await advance(15_000)

    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('is inert when the document has no module scripts', async () => {
    setRunningEntry(undefined)
    await loadHook()
    fetchMock.mockResolvedValue(
      htmlResponse(htmlWithEntry('/assets/index-NEW456.js')),
    )

    const { result } = renderHook(() => useNewVersionAvailable())
    await advance(60_000)
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current).toBe(false)
  })

  it('is inert in development', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    fetchMock.mockResolvedValue(
      htmlResponse(htmlWithEntry('/assets/index-NEW456.js')),
    )

    const { result } = renderHook(() => useNewVersionAvailable())
    await advance(60_000)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current).toBe(false)
  })

  it('stops polling after detecting a new version', async () => {
    fetchMock.mockImplementation(async () =>
      htmlResponse(htmlWithEntry('/assets/index-NEW456.js')),
    )

    const { result } = renderHook(() => useNewVersionAvailable())
    await advance(60_000)

    expect(result.current).toBe(true)

    await advance(5 * 60_000)
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('online'))
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.current).toBe(true)
  })

  it('shares one polling loop between components', async () => {
    fetchMock.mockImplementation(async () =>
      htmlResponse(htmlWithEntry('/assets/index-NEW456.js')),
    )

    const first = renderHook(() => useNewVersionAvailable())
    const second = renderHook(() => useNewVersionAvailable())
    await advance(60_000)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(first.result.current).toBe(true)
    expect(second.result.current).toBe(true)

    // Components mounting after detection see the new version right away
    const third = renderHook(() => useNewVersionAvailable())

    expect(third.result.current).toBe(true)
  })

  it('lets slow checks finish on short intervals', async () => {
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve(htmlResponse(htmlWithEntry('/assets/index-NEW456.js'))),
            8_000,
          )
        }),
    )

    const { result } = renderHook(() =>
      useNewVersionAvailable({ intervalMs: 5_000 }),
    )
    await advance(5_000 + 8_000)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.current).toBe(true)
  })

  it('starts a fresh checker after the last component unmounts', async () => {
    fetchMock.mockImplementation(async () =>
      htmlResponse(htmlWithEntry('/assets/index-NEW456.js')),
    )

    const first = renderHook(() =>
      useNewVersionAvailable({ intervalMs: 5_000 }),
    )
    first.unmount()

    const second = renderHook(() =>
      useNewVersionAvailable({ intervalMs: 5_000 }),
    )
    await advance(5_000)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(second.result.current).toBe(true)
  })

  it('stops polling when the last component unmounts', async () => {
    fetchMock.mockImplementation(async () =>
      htmlResponse(htmlWithEntry(RUNNING_ENTRY)),
    )

    const { unmount } = renderHook(() => useNewVersionAvailable())
    unmount()
    await advance(5 * 60_000)

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
