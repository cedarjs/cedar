// TODO: Remove this
/* eslint @typescript-eslint/no-explicit-any: 0 */

import fs from 'node:fs'
import path from 'node:path'

import { beforeEach, it, describe, vi, beforeAll } from 'vitest'

import { getPaths } from '@cedarjs/project-config'
import { defineScenario } from '@cedarjs/testing/api'
import type { DefineScenario } from '@cedarjs/testing/api'

// Attempt to emulate the request context isolation behavior
// This is a little more complicated than it would necessarily need to be
// but we're following the same pattern as in `@cedarjs/context`
const mockContextStore = vi.hoisted(() => new Map<string, any>())
const mockContext = vi.hoisted(
  () =>
    new Proxy(
      {},
      {
        get: (_target, prop) => {
          // Handle toJSON() calls, i.e. JSON.stringify(context)
          if (prop === 'toJSON') {
            return () => mockContextStore.get('context')
          }

          return mockContextStore.get('context')[prop]
        },
        set: (_target, prop, value) => {
          const ctx = mockContextStore.get('context')
          ctx[prop] = value

          return true
        },
      },
    ),
)

vi.mock('@cedarjs/context', () => {
  return {
    context: mockContext,
    setContext: (newContext: unknown) => {
      mockContextStore.set('context', newContext)
    },
  }
})

beforeEach(() => {
  mockContextStore.set('context', {})
})

declare global {
  // eslint-disable-next-line no-var
  var mockCurrentUser: (currentUser: Record<string, unknown> | null) => void
}

globalThis.mockCurrentUser = (currentUser: Record<string, unknown> | null) => {
  mockContextStore.set('context', { currentUser })
}

// ====================================
// Scenario support
// ====================================

declare global {
  // eslint-disable-next-line no-var
  var defineScenario: DefineScenario
  // eslint-disable-next-line no-var
  var __cedarjs_db_imported__: string
}

globalThis.defineScenario = defineScenario

const cedarPaths = getPaths()

// Error codes thrown by [MySQL, SQLite, Postgres] when foreign key constraint
// fails on DELETE
const FOREIGN_KEY_ERRORS = [1451, 1811, 23503]
const TEARDOWN_CACHE_PATH = path.join(
  cedarPaths.generated.base,
  'scenarioTeardown.json',
)
const DEFAULT_SCENARIO = 'standard'
let teardownOrder: (string | null)[] = []
let originalTeardownOrder: string[] = []

type It = typeof it | typeof it.only
type Describe = typeof describe | typeof describe.only
type TestFunc = (scenarioData: any) => any
type DescribeBlock = (getScenario: () => any) => any

/**
 * Wraps "it" or "test", to seed and teardown the scenario after each test
 * This one passes scenario data to the test function
 */
function buildScenario(itFunc: It) {
  return (
    ...args:
      | [scenarioName: string, testName: string, testFunc: TestFunc]
      | [testName: string, testFunc: TestFunc]
  ) => {
    let scenarioName: string
    let testName: string
    let testFunc: TestFunc

    if (args.length === 3) {
      ;[scenarioName, testName, testFunc] = args
    } else if (args.length === 2) {
      scenarioName = DEFAULT_SCENARIO
      ;[testName, testFunc] = args
    } else {
      throw new Error('scenario() requires 2 or 3 arguments')
    }

    return itFunc(testName, async (ctx) => {
      const testPath = ctx.task.file.filepath
      const { scenario } = await loadScenarios(testPath, scenarioName)

      const scenarioData = await seedScenario(scenario)
      try {
        const result = await testFunc(scenarioData)

        return result
      } finally {
        // Make sure to cleanup, even if test fails
        await teardown()
      }
    })
  }
}

/**
 * This creates a describe() block that will seed the scenario ONCE before all tests in the block
 * Note that you need to use the getScenario() function to get the data.
 */
function buildDescribeScenario(describeFunc: Describe) {
  return (
    ...args: [string, string, DescribeBlock] | [string, DescribeBlock]
  ) => {
    let scenarioName: string
    let describeBlockName: string
    let describeBlock: DescribeBlock

    if (args.length === 3) {
      ;[scenarioName, describeBlockName, describeBlock] = args
    } else if (args.length === 2) {
      scenarioName = DEFAULT_SCENARIO
      ;[describeBlockName, describeBlock] = args
    } else {
      throw new Error('describeScenario() requires 2 or 3 arguments')
    }

    return describeFunc(describeBlockName, () => {
      let scenarioData: Record<string, any>

      beforeAll(async (ctx) => {
        const testPath = ctx.file.filepath
        const { scenario } = await loadScenarios(testPath, scenarioName)
        scenarioData = await seedScenario(scenario)
      })

      afterAll(async () => {
        await teardown()
      })

      const getScenario = () => scenarioData

      describeBlock(getScenario)
    })
  }
}

async function configureTeardown() {
  if (!wasDbImported()) {
    return
  }

  const { getDMMF, getSchema } = await import('@prisma/internals')

  // @NOTE prisma utils are available in cli lib/schemaHelpers
  // But avoid importing them, to prevent memory leaks in jest
  const datamodel = await getSchema(cedarPaths.api.dbSchema)
  const schema = await getDMMF({ datamodel })
  const schemaModels = schema.datamodel.models.map((m) => {
    return m.dbName || m.name
  })

  // check if pre-defined delete order already exists and if so, use it to start
  if (fs.existsSync(TEARDOWN_CACHE_PATH)) {
    teardownOrder = JSON.parse(fs.readFileSync(TEARDOWN_CACHE_PATH).toString())
  }

  // check the number of models in case we've added or removed any models since
  // cache was built
  if (teardownOrder.length !== schemaModels.length) {
    teardownOrder = schemaModels
  }

  // keep a copy of the original order to compare against
  originalTeardownOrder = deepCopy(teardownOrder)
}

beforeAll(async () => {
  await configureTeardown()
})

async function teardown() {
  if (!wasDbImported()) {
    return
  }

  const quoteStyle = await getQuoteStyle()
  const projectDb = await getProjectDb()

  for (const modelName of teardownOrder) {
    try {
      const query = `DELETE FROM ${quoteStyle}${modelName}${quoteStyle}`
      await projectDb.$executeRawUnsafe(query)
    } catch (e) {
      console.error('teardown error\n', e)
      const match = isErrorWithMessage(e) && e.message.match(/Code: `(\d+)`/)

      if (match && FOREIGN_KEY_ERRORS.includes(parseInt(match[1]))) {
        const index = teardownOrder.indexOf(modelName)
        teardownOrder[index] = null
        teardownOrder.push(modelName)
      } else {
        throw e
      }
    }
  }

  // remove nulls
  teardownOrder = teardownOrder.filter((val) => val)

  // if the order of delete changed, write out the cached file again
  if (!isIdenticalArray(teardownOrder, originalTeardownOrder)) {
    originalTeardownOrder = deepCopy(teardownOrder)
    fs.writeFileSync(TEARDOWN_CACHE_PATH, JSON.stringify(teardownOrder))
  }
}

const seedScenario = async (scenario: Record<string, any>) => {
  if (scenario) {
    const scenarios: Record<string, any> = {}

    const projectDb = await getProjectDb()

    for (const [model, namedFixtures] of Object.entries(scenario)) {
      scenarios[model] = {}

      for (const [name, createArgs] of Object.entries(namedFixtures)) {
        if (typeof createArgs === 'function') {
          scenarios[model][name] = await projectDb[model].create(
            createArgs(scenarios),
          )
        } else {
          scenarios[model][name] = await projectDb[model].create(createArgs)
        }
      }
    }

    return scenarios
  } else {
    return {}
  }
}

async function loadScenarios(testPath: string, scenarioName: string) {
  const testFileDir = path.parse(testPath)
  // e.g. ['comments', 'test'] or ['signup', 'state', 'machine', 'test']
  const testFileNameParts = testFileDir.name.split('.')
  const testFilePath = `${testFileDir.dir}/${testFileNameParts
    .slice(0, testFileNameParts.length - 1)
    .join('.')}.scenarios`
  let allScenarios: Record<string, any> | undefined
  let scenario: any

  try {
    allScenarios = await import(testFilePath)
  } catch (e) {
    // ignore error if scenario file not found, otherwise re-throw
    if (isErrorWithCode(e)) {
      if (e instanceof Error) {
        throw e
      } else {
        console.error('unexpected error type', e)
        // eslint-disable-next-line
        throw e
      }
    }
  }

  if (allScenarios) {
    if (allScenarios[scenarioName]) {
      scenario = allScenarios[scenarioName]
    } else {
      throw new Error(
        `UndefinedScenario: There is no scenario named "${scenarioName}" in ` +
          `${testFilePath}.{js,ts}`,
      )
    }
  }
  return { scenario }
}

/**
 * All these hooks run in the VM/Context that the test runs in since we're using
 * "setupAfterEnv".
 * There's a new context for each test-suite i.e. each test file
 *
 * Doing this means if the db isn't used in the current test context, no need to
 * do any of the teardown logic - allowing simple tests to run faster
 * At the same time, if the db is used, disconnecting it in this context
 * prevents connection limit errors.
 * Just disconnecting db in jest-preset is not enough, because the Prisma client
 * is created in a different context.
 */
const wasDbImported = () => {
  return Boolean(globalThis.__cedarjs_db_imported__)
}

let quoteStyle: string
// determine what kind of quotes are needed around table names in raw SQL
async function getQuoteStyle() {
  const { getConfig: getPrismaConfig, getSchema } = await import(
    '@prisma/internals'
  )

  // @NOTE prisma utils are available in cli lib/schemaHelpers
  // But avoid importing them, to prevent memory leaks in jest
  const datamodel = await getSchema(cedarPaths.api.dbSchema)

  if (!quoteStyle) {
    const config = await getPrismaConfig({
      datamodel,
    })

    switch (config.datasources?.[0]?.provider) {
      case 'mysql':
        quoteStyle = '`'
        break
      default:
        quoteStyle = '"'
    }
  }

  return quoteStyle
}

async function getProjectDb() {
  const libDb = await import(`${cedarPaths.api.lib}/db`)

  return libDb.db
}

function isIdenticalArray(a: unknown[], b: unknown[]) {
  return JSON.stringify(a) === JSON.stringify(b)
}

function deepCopy(obj: unknown[]) {
  return JSON.parse(JSON.stringify(obj))
}

function isErrorWithMessage(e: unknown): e is { message: string } {
  return (
    !!e &&
    typeof e === 'object' &&
    'message' in e &&
    typeof e.message === 'string'
  )
}

function isErrorWithCode(e: unknown): e is { code: string } {
  return (
    !!e && typeof e === 'object' && 'code' in e && typeof e.code === 'string'
  )
}

interface GlobalScenario {
  (...args: [string, string, TestFunc] | [string, TestFunc]): ReturnType<It>
  only?: (
    ...args: [string, string, TestFunc] | [string, TestFunc]
  ) => ReturnType<It>
}

interface DescribeScenario {
  (
    ...args: [string, string, DescribeBlock] | [string, DescribeBlock]
  ): ReturnType<Describe>
  only?: (
    ...args: [string, string, DescribeBlock] | [string, DescribeBlock]
  ) => ReturnType<Describe>
}

declare global {
  // eslint-disable-next-line no-var
  var scenario: GlobalScenario
  // eslint-disable-next-line no-var
  var describeScenario: DescribeScenario
}

globalThis.scenario = buildScenario(it)
globalThis.scenario.only = buildScenario(it.only)
globalThis.describeScenario = buildDescribeScenario(describe)
globalThis.describeScenario.only = buildDescribeScenario(describe.only)
