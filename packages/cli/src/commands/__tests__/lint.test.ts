import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { vi, beforeEach, afterEach, test, expect } from 'vitest'

import { runBin } from '@cedarjs/cli-helpers/packageManager/exec'
import { generateGraphQLSchema } from '@cedarjs/internal/dist/generate/graphqlSchema'

import '../../lib/mockTelemetry.js'

let base: string

vi.mock('@cedarjs/cli-helpers/packageManager/exec', () => ({
  runBin: vi.fn(() => ({ exitCode: 0 })),
}))

vi.mock('@cedarjs/internal/dist/generate/graphqlSchema', () => ({
  generateGraphQLSchema: vi.fn(async () => ({ schemaPath: '', errors: [] })),
}))

vi.mock('@cedarjs/project-config', () => ({
  getPaths: () => ({
    base,
    generated: { schema: path.join(base, '.cedar', 'schema.graphql') },
    api: {
      src: path.join(base, 'api', 'src'),
      graphql: path.join(base, 'api', 'src', 'graphql'),
    },
    web: {
      src: path.join(base, 'web', 'src'),
      config: path.join(base, 'web', 'config'),
      storybook: path.join(base, 'web', '.storybook'),
    },
    scripts: path.join(base, 'scripts'),
  }),
}))

import { handler } from '../lint.js'

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'cedar-lint-'))
  fs.mkdirSync(path.join(base, 'api', 'src', 'graphql'), { recursive: true })
  fs.mkdirSync(path.join(base, 'web', 'src'), { recursive: true })
})

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true })
  vi.clearAllMocks()
})

test('generates the GraphQL schema when it is missing', async () => {
  await handler({})

  expect(generateGraphQLSchema).toHaveBeenCalledOnce()
  // Generated before ESLint runs, so the GraphQL rules are in the config
  expect(
    vi.mocked(generateGraphQLSchema).mock.invocationCallOrder[0],
  ).toBeLessThan(vi.mocked(runBin).mock.invocationCallOrder[0])
  expect(fs.existsSync(path.join(base, '.cedar'))).toBe(true)
})

test('leaves an existing GraphQL schema alone', async () => {
  fs.mkdirSync(path.join(base, '.cedar'))
  fs.writeFileSync(path.join(base, '.cedar', 'schema.graphql'), '')

  await handler({})

  expect(generateGraphQLSchema).not.toHaveBeenCalled()
  expect(runBin).toHaveBeenCalledOnce()
})

test('skips the schema when there is no GraphQL api', async () => {
  fs.rmSync(path.join(base, 'api', 'src', 'graphql'), { recursive: true })

  await handler({})

  expect(generateGraphQLSchema).not.toHaveBeenCalled()
  expect(runBin).toHaveBeenCalledOnce()
})

test('still lints when the schema fails to generate', async () => {
  vi.mocked(generateGraphQLSchema).mockResolvedValueOnce({
    schemaPath: '',
    errors: [{ message: 'Schema loading failed', error: new Error() }],
  })
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

  await handler({})

  expect(warn).toHaveBeenCalledWith('Schema loading failed')
  expect(runBin).toHaveBeenCalledOnce()
  expect(process.exitCode).toBe(0)
})
