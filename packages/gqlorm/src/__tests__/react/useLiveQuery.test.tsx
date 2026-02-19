import { renderHook } from '@testing-library/react'
import { describe, expect, it, beforeEach, vi } from 'vitest'

import { useLiveQuery } from '../../react/useLiveQuery.js'

const useQueryMock = vi.fn()

vi.mock('@cedarjs/web', () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}))

describe('useLiveQuery', () => {
  beforeEach(() => {
    useQueryMock.mockReset()
    useQueryMock.mockReturnValue({
      data: undefined,
      loading: true,
      error: undefined,
      networkStatus: 1,
      refetch: vi.fn(),
    })
  })

  it('builds a live query and forwards it to Cedar useQuery', () => {
    const queryFn = (db: any) => db.user.findMany({ where: { isActive: true } })

    renderHook(() =>
      useLiveQuery(queryFn, {
        fetchPolicy: 'network-only',
      } as any),
    )

    expect(useQueryMock).toHaveBeenCalledTimes(1)

    const [document, options] = useQueryMock.mock.calls[0]
    const source = document?.loc?.source?.body ?? ''

    expect(source).toContain('@live')
    expect(source).toContain('users')
    expect(options.variables).toEqual({ var0: true })
    expect(options.fetchPolicy).toBe('network-only')
  })

  it('returns extracted root field data', () => {
    const users = [
      { id: 1, name: 'Ada' },
      { id: 2, name: 'Linus' },
    ]

    useQueryMock.mockReturnValue({
      data: { users },
      loading: false,
      error: undefined,
      networkStatus: 7,
      refetch: vi.fn(),
    })

    const queryFn = (db: any) => db.user.findMany()
    const { result } = renderHook(() => useLiveQuery(queryFn))

    expect(result.current.data).toEqual(users)
    expect(result.current.loading).toBe(false)
  })
})
