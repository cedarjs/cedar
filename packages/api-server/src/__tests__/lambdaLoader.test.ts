import path from 'path'

import {
  vi,
  beforeAll,
  afterAll,
  afterEach,
  describe,
  it,
  expect,
} from 'vitest'

import {
  CEDAR_HANDLERS,
  LAMBDA_FUNCTIONS,
  loadFunctionsFromDist,
} from '../plugins/lambdaLoader.js'

// Suppress terminal logging.
console.log = vi.fn()
console.warn = vi.fn()

// Set up CEDAR_CWD.
let original_CEDAR_CWD: string | undefined

beforeAll(() => {
  original_CEDAR_CWD = process.env.CEDAR_CWD
  process.env.CEDAR_CWD = path.resolve(__dirname, 'fixtures/graphql/cedar-app')
})

afterAll(() => {
  process.env.CEDAR_CWD = original_CEDAR_CWD
})

// Reset the LAMBDA_FUNCTIONS map and CEDAR_HANDLERS map after each test.
afterEach(() => {
  LAMBDA_FUNCTIONS.clear()
  CEDAR_HANDLERS.clear()
})

describe('loadFunctionsFromDist', () => {
  it('loads functions from the api/dist directory', async () => {
    expect(LAMBDA_FUNCTIONS.size).toBe(0)

    await loadFunctionsFromDist()

    expect(Object.fromEntries(LAMBDA_FUNCTIONS)).toEqual({
      'another-graphql': expect.any(Function),
      env: expect.any(Function),
      graphql: expect.any(Function),
      health: expect.any(Function),
      hello: expect.any(Function),
      nested: expect.any(Function),
    })
  })

  // We have logic that specifically puts the graphql function at the front.
  // Though it's not clear why or if this is actually respected by how JS objects work.
  // See the complementary lambdaLoaderNumberFunctions test.
  it('puts the graphql function first', async () => {
    expect(LAMBDA_FUNCTIONS.size).toBe(0)

    await loadFunctionsFromDist()

    expect([...LAMBDA_FUNCTIONS.keys()][0]).toEqual('graphql')
  })

  // `loadFunctionsFromDist` loads files that don't export a handler into the map as `undefined`.
  // This is probably harmless, but we could also probably go without it.
  it("warns if a function doesn't have a handler and sets it to `undefined`", async () => {
    expect(LAMBDA_FUNCTIONS.size).toBe(0)

    await loadFunctionsFromDist()

    expect(LAMBDA_FUNCTIONS.get('noHandler')).toBeUndefined()

    expect(console.warn).toHaveBeenCalledWith(
      'noHandler',
      'at',
      expect.any(String),
      'does not have a function called handler or handleRequest defined.',
    )
  })

  describe('when "discoverFunctionsGlob" is set', () => {
    it('loads the same functions as the default value', async () => {
      expect(LAMBDA_FUNCTIONS.size).toBe(0)

      await loadFunctionsFromDist({
        discoverFunctionsGlob: ['dist/functions/**/*.{ts,js}'],
      })

      expect(Object.fromEntries(LAMBDA_FUNCTIONS)).toEqual({
        'another-graphql': expect.any(Function),
        env: expect.any(Function),
        graphql: expect.any(Function),
        health: expect.any(Function),
        hello: expect.any(Function),
        nested: expect.any(Function),
      })
    })

    it('loads functions when discoverFunctionsGlob is an array', async () => {
      expect(LAMBDA_FUNCTIONS.size).toBe(0)

      await loadFunctionsFromDist({
        discoverFunctionsGlob: ['dist/functions/**/[eg]*.{ts,js}'],
      })

      expect(Object.fromEntries(LAMBDA_FUNCTIONS)).toEqual({
        graphql: expect.any(Function),
        env: expect.any(Function),
      })
    })

    it('loads functions when discoverFunctionsGlob has include and exclude values', async () => {
      expect(LAMBDA_FUNCTIONS.size).toBe(0)

      await loadFunctionsFromDist({
        discoverFunctionsGlob: [
          'dist/functions/**/*.{ts,js}',
          '!dist/functions/**/he*.{ts,js}',
        ],
      })

      expect(Object.fromEntries(LAMBDA_FUNCTIONS)).toEqual({
        'another-graphql': expect.any(Function),
        env: expect.any(Function),
        graphql: expect.any(Function),
        nested: expect.any(Function),
      })
    })
  })
})
