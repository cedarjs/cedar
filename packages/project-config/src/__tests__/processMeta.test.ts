import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { writeApiProcessMeta } from '../processMeta.js'

describe('writeApiProcessMeta', () => {
  let projectDir: string
  const originalCedarCwd = process.env.CEDAR_CWD

  const readMeta = (dir: string) =>
    JSON.parse(
      fs.readFileSync(
        path.join(projectDir, dir, 'process-meta', 'api.json'),
        'utf-8',
      ),
    )

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cedar-process-meta-'))
    fs.writeFileSync(path.join(projectDir, 'cedar.toml'), '')
    process.env.CEDAR_CWD = projectDir
  })

  afterEach(() => {
    if (originalCedarCwd === undefined) {
      delete process.env.CEDAR_CWD
    } else {
      process.env.CEDAR_CWD = originalCedarCwd
    }

    fs.rmSync(projectDir, { recursive: true, force: true })
  })

  it('writes .cedar/process-meta/api.json, creating the directories', () => {
    writeApiProcessMeta({ port: 8921, host: '::', rootPath: '/api/' })

    const meta = readMeta('.cedar')

    expect(meta).toEqual({
      version: 1,
      port: 8921,
      host: '::',
      rootPath: '/api/',
      pid: process.pid,
      startedAt: expect.any(String),
    })
    expect(Date.parse(meta.startedAt)).toBeLessThanOrEqual(Date.now())
    expect(
      fs.readdirSync(path.join(projectDir, '.cedar', 'process-meta')),
    ).toEqual(['api.json'])
  })

  it('leaves out rootPath when it is not known', () => {
    writeApiProcessMeta({ port: 8911, host: '127.0.0.1' })

    expect(readMeta('.cedar')).not.toHaveProperty('rootPath')
  })

  it('writes to .redwood/ in projects that use it', () => {
    fs.mkdirSync(path.join(projectDir, '.redwood'))

    writeApiProcessMeta({ port: 8911, host: '::' })

    expect(readMeta('.redwood').port).toEqual(8911)
    expect(fs.existsSync(path.join(projectDir, '.cedar'))).toBe(false)
  })

  it('replaces what an earlier start wrote', () => {
    writeApiProcessMeta({ port: 8911, host: '::' })
    writeApiProcessMeta({ port: 8921, host: '::' })

    expect(readMeta('.cedar').port).toEqual(8921)
  })
})
