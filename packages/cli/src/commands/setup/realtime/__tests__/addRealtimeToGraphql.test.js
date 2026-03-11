import fs from 'node:fs'
import path from 'node:path'

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

let functionsDir = null

const fixtures = vi.hoisted(() => [
  'aliased-import',
  'default-graphql-function',
  'evil-graphql-function',
  'function-graphql-function',
  'modified-graphql-function',
  'wrapper-function',
  'wrapper-function-commented',
])

vi.mock('node:fs', async (importOriginal) => {
  const originalFs = await importOriginal()
  const path = await import('node:path')

  const inMemoryFiles = {}

  for (const fixture of fixtures) {
    const fixturePath = path.join(import.meta.dirname, fixture, 'graphql.js')
    const source = originalFs.readFileSync(fixturePath, 'utf8')
    inMemoryFiles[fixturePath] = source
  }

  const mockFs = {
    existsSync: vi.fn((path) => {
      return !!inMemoryFiles[path]
    }),
    readFileSync: (p) => {
      const inMemoryFile = inMemoryFiles[p]

      if (inMemoryFile) {
        return inMemoryFile
      }
    },
    writeFileSync: vi.fn((p, content) => {
      inMemoryFiles[p] = content
    }),
  }

  return { ...mockFs, default: mockFs }
})

vi.mock('@cedarjs/project-config', () => {
  return {
    getPaths: () => {
      return { api: { functions: functionsDir } }
    },
  }
})

vi.mock('@cedarjs/cli-helpers', () => {
  return {
    isTypeScriptProject: () => {
      return false
    },
  }
})

import { addRealtimeToGraphqlHandler } from '../addRealtimeToGraphql.js'

describe('addRealtimeToGraphqlHandler (filesystem)', () => {
  beforeEach(() => {
    functionsDir = null
  })

  afterEach(() => {
    functionsDir = null
    vi.restoreAllMocks()
  })

  it('adds realtime import and option for the default fixture', () => {
    functionsDir = path.join(import.meta.dirname, 'default-graphql-function')
    const graphqlPath = path.join(functionsDir, 'graphql.js')

    const ctx = {}
    const task = { skip: vi.fn() }

    addRealtimeToGraphqlHandler(ctx, task)

    const modified = fs.readFileSync(graphqlPath, 'utf8')

    expect(fs.writeFileSync).toHaveBeenCalled()
    expect(modified).toContain("import { realtime } from 'src/lib/realtime'")
    expect(modified).toContain('realtime,')
    expect(ctx.realtimeHandlerSkipped).not.toBe(true)
    expect(task.skip).not.toHaveBeenCalled()

    // Running again should be idempotent and cause a skip
    addRealtimeToGraphqlHandler(ctx, task)
    expect(ctx.realtimeHandlerSkipped).toBe(true)
    expect(task.skip).toHaveBeenCalledWith('Realtime import already exists')
  })

  const nonModifiableFixtures = fixtures.filter(
    (f) => f !== 'default-graphql-function',
  )

  for (const fixture of nonModifiableFixtures) {
    it(`skips for fixture "${fixture}" (handler not found)`, () => {
      functionsDir = path.join(import.meta.dirname, fixture)

      const ctx = {}
      const task = { skip: vi.fn() }

      addRealtimeToGraphqlHandler(ctx, task)

      expect(ctx.realtimeHandlerSkipped).toBe(true)
      expect(task.skip).toHaveBeenCalledWith(
        'Unexpected syntax. Handler not found',
      )
      expect(fs.writeFileSync).not.toHaveBeenCalled()
    })
  }

  it('skips when GraphQL handler file is missing', () => {
    functionsDir = path.join(import.meta.dirname, 'does-not-exist')

    const ctx = {}
    const task = { skip: vi.fn() }

    addRealtimeToGraphqlHandler(ctx, task)

    expect(ctx.realtimeHandlerSkipped).toBe(true)
    expect(task.skip).toHaveBeenCalledWith('GraphQL handler not found')
    expect(fs.writeFileSync).not.toHaveBeenCalled()
  })
})
