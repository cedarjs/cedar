import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

import { gHistory, navigate } from '../history.js'
import { useBlocker } from '../useBlocker.js'

describe('useBlocker', () => {
  it('should initialize with IDLE state', () => {
    const { result } = renderHook(() => useBlocker({ when: false }))
    expect(result.current.state).toBe('IDLE')
  })

  it('should change state to BLOCKED when blocker is triggered', () => {
    const { result, unmount } = renderHook(() => useBlocker({ when: true }))
    act(() => {
      navigate('/test')
    })
    expect(result.current.state).toBe('BLOCKED')
    unmount()
  })

  it('should not block when "when" is false', () => {
    const { result, unmount } = renderHook(() => useBlocker({ when: false }))
    act(() => {
      navigate('/test')
    })
    expect(result.current.state).toBe('IDLE')
    unmount()
  })

  it('should confirm navigation when confirm is called', () => {
    const { result, unmount } = renderHook(() => useBlocker({ when: true }))
    act(() => {
      navigate('/test')
    })
    expect(result.current.state).toBe('BLOCKED')
    act(() => {
      result.current.confirm()
    })
    expect(result.current.state).toBe('IDLE')
    unmount()
  })

  it('should abort navigation when abort is called', () => {
    const { result, unmount } = renderHook(() => useBlocker({ when: true }))
    act(() => {
      navigate('/test')
    })
    expect(result.current.state).toBe('BLOCKED')
    act(() => {
      result.current.abort()
    })
    expect(result.current.state).toBe('IDLE')
    unmount()
  })

  it('should not call listener when navigation is aborted', () => {
    const listener = vi.fn()
    const listenerId = gHistory.listen(listener)

    const { result, unmount } = renderHook(() => useBlocker({ when: true }))

    act(() => {
      navigate('/test-abort')
    })
    expect(result.current.state).toBe('BLOCKED')

    act(() => {
      result.current.abort()
    })

    expect(listener).not.toHaveBeenCalled()
    expect(result.current.state).toBe('IDLE')

    gHistory.remove(listenerId)
    unmount()
  })

  it('should call listener when navigation is confirmed', () => {
    const listener = vi.fn()
    const listenerId = gHistory.listen(listener)

    const { result, unmount } = renderHook(() => useBlocker({ when: true }))

    act(() => {
      navigate('/test-confirm')
    })
    expect(result.current.state).toBe('BLOCKED')

    act(() => {
      result.current.confirm()
    })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(result.current.state).toBe('IDLE')

    gHistory.remove(listenerId)
    unmount()
  })

  describe('when function', () => {
    it('should initialize with IDLE state when using a function', () => {
      const { result, unmount } = renderHook(() =>
        useBlocker({ when: () => false }),
      )
      expect(result.current.state).toBe('IDLE')
      unmount()
    })

    it('should block when function returns true', () => {
      const whenFn = vi.fn(() => true)
      const { result, unmount } = renderHook(() => useBlocker({ when: whenFn }))

      act(() => {
        navigate('/blocked-path')
      })

      expect(whenFn).toHaveBeenCalled()
      expect(result.current.state).toBe('BLOCKED')
      unmount()
    })

    it('should not block when function returns false', () => {
      const whenFn = vi.fn(() => false)
      const { result, unmount } = renderHook(() => useBlocker({ when: whenFn }))

      act(() => {
        navigate('/allowed-path')
      })

      expect(whenFn).toHaveBeenCalled()
      expect(result.current.state).toBe('IDLE')
      unmount()
    })

    it('should pass nextLocation to when function', () => {
      const whenFn = vi.fn(() => true)
      const { result, unmount } = renderHook(() => useBlocker({ when: whenFn }))

      act(() => {
        navigate('/new-destination')
      })

      expect(whenFn).toHaveBeenCalledWith({
        nextLocation: '/new-destination',
      })
      expect(result.current.state).toBe('BLOCKED')
      unmount()
    })

    it('should block based on nextLocation', () => {
      const whenFn = vi.fn(({ nextLocation }: { nextLocation: string }) =>
        nextLocation.startsWith('/protected'),
      )
      const { result, unmount } = renderHook(() => useBlocker({ when: whenFn }))

      act(() => {
        navigate('/allowed')
      })
      expect(result.current.state).toBe('IDLE')

      act(() => {
        navigate('/protected/page')
      })
      expect(result.current.state).toBe('BLOCKED')

      unmount()
    })
  })
})
