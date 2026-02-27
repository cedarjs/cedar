import { PrismaClient } from '@prisma/client'
import { describe, afterEach, it, vi, expect } from 'vitest'

import { InMemoryClient } from '../clients/InMemoryClient.js'
import { createCache } from '../index.js'

const mockFindFirst = vi.fn()
const mockFindMany = vi.fn()

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(() => ({
    user: {
      findFirst: mockFindFirst,
      findMany: mockFindMany,
    },
  })),
}))

describe('cacheFindMany', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('adds the collection to the cache based on latest updated user', async () => {
    const now = new Date()

    const user = {
      id: 1,
      email: 'rob@cedarjs.com',
      updatedAt: now,
    }
    mockFindFirst.mockImplementation(() => user)
    mockFindMany.mockImplementation(() => [user])

    const client = new InMemoryClient()
    const { cacheFindMany } = createCache(client)
    const spy = vi.spyOn(client, 'set')

    await cacheFindMany('test', PrismaClient().user)

    expect(spy).toHaveBeenCalled()
    expect(client.storage[`test-1-${now.getTime()}`].value).toEqual(
      JSON.stringify([user]),
    )
  })

  it('adds a new collection if a record has been updated', async () => {
    const now = new Date()
    const user = {
      id: 1,
      email: 'rob@cedarjs.com',
      updatedAt: now,
    }
    const client = new InMemoryClient({
      [`test-1-${now.getTime()}`]: {
        expires: 1977175194415,
        value: JSON.stringify([user]),
      },
    })

    // set mock to return user that's been updated in the future, rather than
    // the timestamp that's been cached already
    const future = new Date()
    future.setSeconds(future.getSeconds() + 1000)
    user.updatedAt = future
    mockFindFirst.mockImplementation(() => user)
    mockFindMany.mockImplementation(() => [user])

    const { cacheFindMany } = createCache(client)
    const spy = vi.spyOn(client, 'set')

    await cacheFindMany('test', PrismaClient().user)

    expect(spy).toHaveBeenCalled()
    // the `now` cache still exists
    expect(
      JSON.parse(client.storage[`test-1-${now.getTime()}`].value)[0].id,
    ).toEqual(1)
    // the `future` cache should have been created
    expect(client.storage[`test-1-${future.getTime()}`].value).toEqual(
      JSON.stringify([user]),
    )
  })

  it('skips caching and just runs the findMany() if there are no records', async () => {
    const client = new InMemoryClient()
    mockFindFirst.mockImplementation(() => null)
    mockFindMany.mockImplementation(() => [])
    const { cacheFindMany } = createCache(client)
    const getSpy = vi.spyOn(client, 'get')
    const setSpy = vi.spyOn(client, 'set')

    const result = await cacheFindMany('test', PrismaClient().user)

    expect(result).toEqual([])
    expect(getSpy).not.toHaveBeenCalled()
    expect(setSpy).not.toHaveBeenCalled()
  })

  it('treats Prisma validation errors as missing fields and reruns the query', async () => {
    const client = new InMemoryClient()
    const logger = { debug: vi.fn(), error: vi.fn() }
    // @ts-expect-error - only mocking the functions we need on `logger`
    const { cacheFindMany } = createCache(client, { logger })
    const error = Object.assign(new Error('invalid field'), {
      name: 'PrismaClientValidationError',
    })

    mockFindFirst.mockRejectedValue(error)
    mockFindMany.mockResolvedValue([{ id: 1, updatedAt: new Date() }])

    const result = await cacheFindMany('test', PrismaClient().user)

    expect(result).toEqual([{ id: 1, updatedAt: expect.any(String) }])
    expect(logger.error).toHaveBeenCalledWith(
      `[Cache] cacheFindMany error: model does not contain \`id\` or \`updatedAt\` fields`,
    )
  })

  it('logs a generic Prisma error message for non-validation failures', async () => {
    const client = new InMemoryClient()
    const logger = { debug: vi.fn(), error: vi.fn() }
    // @ts-expect-error - only mocking the functions we need on `logger`
    const { cacheFindMany } = createCache(client, { logger })
    const error = new Error('random failure')

    mockFindFirst.mockRejectedValue(error)
    mockFindMany.mockResolvedValue([{ id: 2, updatedAt: new Date() }])

    const result = await cacheFindMany('test', PrismaClient().user)

    expect(result).toEqual([{ id: 2, updatedAt: expect.any(String) }])
    expect(logger.error).toHaveBeenCalledWith(
      `[Cache] cacheFindMany error: random failure`,
    )
  })
})
