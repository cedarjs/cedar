import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { API_PORT_FILE_NAME, writeApiPortFile } from '../apiPortFile.js'

describe('writeApiPortFile', () => {
  let projectDir: string
  const originalCedarCwd = process.env.CEDAR_CWD

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cedar-api-port-'))
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

  it('writes the port to .cedar/, creating the directory', () => {
    writeApiPortFile(8921)

    expect(
      fs.readFileSync(
        path.join(projectDir, '.cedar', API_PORT_FILE_NAME),
        'utf-8',
      ),
    ).toEqual('8921\n')
  })

  it('writes to .redwood/ in projects that use it', () => {
    fs.mkdirSync(path.join(projectDir, '.redwood'))

    writeApiPortFile(8911)

    expect(
      fs.readFileSync(
        path.join(projectDir, '.redwood', API_PORT_FILE_NAME),
        'utf-8',
      ),
    ).toEqual('8911\n')
    expect(fs.existsSync(path.join(projectDir, '.cedar'))).toBe(false)
  })

  it('replaces the port written by an earlier start', () => {
    writeApiPortFile(8911)
    writeApiPortFile(8921)

    expect(
      fs.readFileSync(
        path.join(projectDir, '.cedar', API_PORT_FILE_NAME),
        'utf-8',
      ),
    ).toEqual('8921\n')
  })
})
