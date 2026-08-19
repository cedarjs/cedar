import { useEngine } from '@envelop/core'
import * as GraphQLJS from 'graphql'
import { expect, test } from 'vitest'

import type { GlobalContext } from '@cedarjs/context'
import { context, setContext } from '@cedarjs/context'
import { getAsyncStoreInstance } from '@cedarjs/context/dist/store'

import { useCedarGlobalContextSetter } from '../useCedarGlobalContextSetter.js'
import { useCedarPopulateContext } from '../useCedarPopulateContext.js'

import { testSchema, testQuery } from './__fixtures__/common.js'
import { createTestkit } from './__fixtures__/envelop-testing.js'

test('Context is correctly populated', async () => {
  const testkit = createTestkit(
    [
      useEngine(GraphQLJS),
      useCedarPopulateContext(() => ({ hello: 'world' })),
      useCedarPopulateContext({ foo: 'bar' }),
      useCedarGlobalContextSetter(),
    ],
    testSchema,
  )

  await getAsyncStoreInstance().run(
    new Map<string, GlobalContext>(),
    async () => {
      await testkit.execute(testQuery, {}, {})

      expect(context.hello).toBe('world')
      expect(context.foo).toBe('bar')
      expect(context.bazinga).toBeUndefined()
    },
  )
})

test('Plugin lets you populate context at any point in the lifecycle', async () => {
  const testkit = createTestkit(
    [
      useEngine(GraphQLJS),
      useCedarGlobalContextSetter(),
      useCedarPopulateContext(() => ({ hello: 'world' })),
      useCedarPopulateContext({ foo: 'bar' }),
      useCedarPopulateContext({ bazinga: 'new value!' }),
    ],
    testSchema,
  )

  await getAsyncStoreInstance().run(
    new Map<string, GlobalContext>(),
    async () => {
      await testkit.execute(testQuery, {}, {})

      expect(context.hello).toBe('world')
      expect(context.foo).toBe('bar')
      expect(context.bazinga).toBe('new value!')
    },
  )
})

test('setContext erases the existing context', async () => {
  const testkit = createTestkit(
    [
      useEngine(GraphQLJS),
      useCedarPopulateContext(() => ({ hello: 'world' })),
      useCedarPopulateContext({ foo: 'bar' }),
      useCedarGlobalContextSetter(),
    ],
    testSchema,
  )

  await getAsyncStoreInstance().run(
    new Map<string, GlobalContext>(),
    async () => {
      await testkit.execute(testQuery, {}, {})
      setContext({ bazinga: 'new value!' })

      expect(context.hello).toBeUndefined()
      expect(context.foo).toBeUndefined()
      expect(context.bazinga).toBe('new value!')
    },
  )
})
