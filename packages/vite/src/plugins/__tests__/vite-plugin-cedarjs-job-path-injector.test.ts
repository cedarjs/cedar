import path from 'node:path'

import { vol } from 'memfs'
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'

import { cedarjsJobPathInjectorPlugin } from '../vite-plugin-cedarjs-job-path-injector.js'

vi.mock('fs', async () => ({ default: (await import('memfs')).fs }))

const RWJS_CWD = process.env.RWJS_CWD
const TEST_RWJS_CWD = '/Users/tobbe/test-app/'
process.env.RWJS_CWD = TEST_RWJS_CWD

// Mock the getPaths function
vi.mock('@cedarjs/project-config', () => ({
  getPaths: () => ({
    api: {
      jobs: path.join(TEST_RWJS_CWD, 'api/src/jobs'),
    },
  }),
}))

function getPluginTransform() {
  const plugin = cedarjsJobPathInjectorPlugin()

  if (typeof plugin.transform !== 'function') {
    expect.fail('Expected plugin to have a transform function')
  }

  // Calling `bind` to please TS
  // Typecasting because we're only going to call transform, and we don't need
  // anything provided by the context.
  // This used to be `{} as any`, but that requires transient
  // dependencies to match versions. Using `ThisParameterType` is more resilient
  return plugin.transform.bind({} as ThisParameterType<typeof plugin.transform>)
}

beforeAll(() => {
  // Add a toml entry for getPaths et al.
  vol.fromJSON({ 'redwood.toml': '' }, TEST_RWJS_CWD)
})

afterAll(() => {
  process.env.RWJS_CWD = RWJS_CWD
})

describe('cedarjsJobPathInjectorPlugin', () => {
  it('should inject path and name into createJob call with empty object', async () => {
    const transform = getPluginTransform()
    const testFilePath = path.join(TEST_RWJS_CWD, 'api/src/jobs/testJob.js')

    const code = 'export const testJob = jobs.createJob({})'

    const result = await transform(code, testFilePath)

    if (!isResultWithCode(result)) {
      throw new Error('transform should have returned a result with code')
    }

    expect(result.code).toContain('name: "testJob"')
    expect(result.code).toContain('path: "testJob"')
  })

  it('should inject path and name into createJob call with existing properties', async () => {
    const transform = getPluginTransform()
    const testFilePath = path.join(TEST_RWJS_CWD, 'api/src/jobs/emailJob.js')

    const code = `
      export const emailJob = jobs.createJob({
        queue: 'email',
        perform: async (data) => {
          // send email
        }
      })
    `

    const result = await transform(code, testFilePath)

    if (!isResultWithCode(result)) {
      throw new Error('transform should have returned a result with code')
    }

    expect(result.code).toContain('name: "emailJob"')
    expect(result.code).toContain('path: "emailJob"')
    expect(result.code).toContain("queue: 'email'")
    expect(result.code).toContain('perform: async (data)')
  })

  it('should handle nested directory paths correctly', async () => {
    const transform = getPluginTransform()
    const testFilePath = path.join(
      TEST_RWJS_CWD,
      'api/src/jobs/admin/cleanupJob.js',
    )

    const code = `
      export const cleanupJob = jobs.createJob({
        queue: 'maintenance'
      })
    `

    const result = await transform(code, testFilePath)

    if (!isResultWithCode(result)) {
      throw new Error('transform should have returned a result with code')
    }

    expect(result.code).toMatch(/path: "admin(\/|\\\\)cleanupJob"/)
    expect(result.code).toMatch('name: "cleanupJob"')
  })

  it('should handle TypeScript files', async () => {
    const transform = getPluginTransform()
    const testFilePath = path.join(TEST_RWJS_CWD, 'api/src/jobs/processJob.ts')

    const code = `
      export const processJob = jobs.createJob({
        queue: 'processing',
        perform: async (data: JobData) => {
          // process data
        }
      })
    `

    const result = await transform(code, testFilePath)

    if (!isResultWithCode(result)) {
      throw new Error('transform should have returned a result with code')
    }

    expect(result.code).toContain('path: "processJob"')
    expect(result.code).toContain('name: "processJob"')
  })

  it('should handle multiple createJob calls in the same file', async () => {
    const transform = getPluginTransform()
    const testFilePath = path.join(TEST_RWJS_CWD, 'api/src/jobs/multiJob.js')

    const code = `
      export const firstJob = jobs.createJob({
        queue: 'first'
      })

      export const secondJob = jobs.createJob({
        queue: 'second'
      })
    `

    const result = await transform(code, testFilePath)

    if (!isResultWithCode(result)) {
      throw new Error('transform should have returned a result with code')
    }

    expect(result.code).toContain('path: "multiJob"')
    expect(result.code).toContain('name: "firstJob"')
    expect(result.code).toContain('name: "secondJob"')
  })

  it('should return null for files without createJob calls', async () => {
    const transform = getPluginTransform()
    const testFilePath = path.join(TEST_RWJS_CWD, 'api/src/jobs/noJob.js')

    const code = `
      export const someFunction = () => {
        return 'not a job'
      }
    `

    const result = await transform(code, testFilePath)

    expect(result).toBeNull()
  })

  it('should handle different member expression patterns', async () => {
    const transform = getPluginTransform()
    const testFilePath = path.join(TEST_RWJS_CWD, 'api/src/jobs/aliasedJob.js')

    const code = `
      import { jobs as j } from '@cedarjs/api'

      export const aliasedJob = j.createJob({
        queue: 'aliased'
      })
    `

    const result = await transform(code, testFilePath)

    if (!isResultWithCode(result)) {
      throw new Error('transform should have returned a result with code')
    }

    expect(result.code).toContain('path: "aliasedJob"')
    expect(result.code).toContain('name: "aliasedJob"')
  })

  it('should handle createJob calls with complex object properties', async () => {
    const transform = getPluginTransform()
    const testFilePath = path.join(TEST_RWJS_CWD, 'api/src/jobs/complexJob.js')

    const code = `
      export const complexJob = jobs.createJob({
        queue: 'complex',
        attempts: 3,
        perform: async (data) => {
          console.log('Processing:', data)
        },
        onFailure: (error) => {
          console.error('Failed:', error)
        }
      })
    `

    const result = await transform(code, testFilePath)

    if (!isResultWithCode(result)) {
      throw new Error('transform should have returned a result with code')
    }

    expect(result.code).toContain('path: "complexJob"')
    expect(result.code).toContain('name: "complexJob"')
    expect(result.code).toContain("queue: 'complex'")
    expect(result.code).toContain('attempts: 3')
    expect(result.code).toContain('perform: async (data)')
    expect(result.code).toContain('onFailure: (error)')
  })

  it('should not modify files that do not match the expected pattern', async () => {
    const transform = getPluginTransform()
    const testFilePath = path.join(TEST_RWJS_CWD, 'api/src/jobs/notAJob.js')

    const code = `
      // This mentions createJob but doesn't actually call it
      const comment = 'Use createJob to create a job'

      export const notAJob = someOtherFunction({
        queue: 'not-a-job'
      })
    `

    const result = await transform(code, testFilePath)

    expect(result).toBeNull()
  })
})

function isResultWithCode(result: unknown): result is { code: string } {
  return !!result && typeof result === 'object' && 'code' in result
}
