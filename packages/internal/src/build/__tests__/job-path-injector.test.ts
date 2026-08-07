import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { applyJobPathInjector } from '../job-path-injector.js'

const JOBS_DIR = '/test-app/api/src/jobs'

function jobFile(...segments: string[]) {
  return path.join(JOBS_DIR, ...segments)
}

describe('applyJobPathInjector', () => {
  it('injects path and name into a createJob call with an empty object', () => {
    const code = 'export const testJob = jobs.createJob({})'

    const result = applyJobPathInjector(code, jobFile('testJob.js'), JOBS_DIR)

    expect(result).toContain('path: "testJob"')
    expect(result).toContain('name: "testJob"')
  })

  it('injects path and name into a createJob call with existing properties', () => {
    const code = `
      export const emailJob = jobs.createJob({
        queue: 'email',
        perform: async (data) => {
          // send email
        }
      })
    `

    const result = applyJobPathInjector(code, jobFile('emailJob.js'), JOBS_DIR)

    expect(result).toContain('path: "emailJob"')
    expect(result).toContain('name: "emailJob"')
    expect(result).toContain("queue: 'email'")
    expect(result).toContain('perform: async (data)')
  })

  it('handles object literals with trailing commas', () => {
    const code = `
      export const sampleJob = jobs.createJob({
        queue: 'default',
        perform: async () => {
          console.log('performing')
        },
      })
    `

    const result = applyJobPathInjector(code, jobFile('sampleJob.ts'), JOBS_DIR)

    expect(result).toContain('path: "sampleJob"')
    expect(result).toContain('name: "sampleJob"')
    // The insert must not produce `,,` after the existing trailing comma
    expect(result).not.toMatch(/,\s*,/)
  })

  it('handles nested directory paths', () => {
    const code = `
      export const cleanupJob = jobs.createJob({
        queue: 'maintenance'
      })
    `

    const result = applyJobPathInjector(
      code,
      jobFile('admin', 'cleanupJob.js'),
      JOBS_DIR,
    )

    expect(result).toMatch(/path: "admin(\/|\\\\)cleanupJob"/)
    expect(result).toContain('name: "cleanupJob"')
  })

  it('handles TypeScript files', () => {
    const code = `
      export const processJob = jobs.createJob({
        queue: 'processing',
        perform: async (data: JobData) => {
          // process data
        }
      })
    `

    const result = applyJobPathInjector(
      code,
      jobFile('processJob.ts'),
      JOBS_DIR,
    )

    expect(result).toContain('path: "processJob"')
    expect(result).toContain('name: "processJob"')
  })

  it('handles multiple createJob calls in the same file', () => {
    const code = `
      export const firstJob = jobs.createJob({
        queue: 'first'
      })

      export const secondJob = jobs.createJob({
        queue: 'second'
      })
    `

    const result = applyJobPathInjector(code, jobFile('multiJob.js'), JOBS_DIR)

    expect(result).toContain('path: "multiJob"')
    expect(result).toContain('name: "firstJob"')
    expect(result).toContain('name: "secondJob"')
  })

  it('handles different member expression objects', () => {
    const code = `
      import { jobs as j } from '@cedarjs/api'

      export const aliasedJob = j.createJob({
        queue: 'aliased'
      })
    `

    const result = applyJobPathInjector(
      code,
      jobFile('aliasedJob.js'),
      JOBS_DIR,
    )

    expect(result).toContain('path: "aliasedJob"')
    expect(result).toContain('name: "aliasedJob"')
  })

  it('handles createJob on a later declarator in a multi-variable export', () => {
    const code = `
      export const notAJob = 1,
        comboJob = jobs.createJob({ queue: 'combo' })
    `

    const result = applyJobPathInjector(code, jobFile('comboJob.js'), JOBS_DIR)

    expect(result).toContain('path: "comboJob"')
    expect(result).toContain('name: "comboJob"')
    expect(result).not.toContain('name: "notAJob"')
  })

  it('returns null for files without createJob calls', () => {
    const code = `
      export const someFunction = () => {
        return 'not a job'
      }
    `

    const result = applyJobPathInjector(code, jobFile('noJob.js'), JOBS_DIR)

    expect(result).toBeNull()
  })

  it('returns null for createJob calls that are not exported consts', () => {
    const code = `
      const localJob = jobs.createJob({ queue: 'local' })
    `

    const result = applyJobPathInjector(code, jobFile('localJob.js'), JOBS_DIR)

    expect(result).toBeNull()
  })
})
