import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'

import {
  apiDistServerFileExists,
  apiDistServerFilePath,
  runApiDistServerFile,
} from '../serverFile.js'

const NO_SERVER_FILE_FIXTURE = path.join(
  import.meta.dirname,
  'fixtures/graphql/cedar-app',
)
const SERVER_FILE_FIXTURE = path.join(
  import.meta.dirname,
  'fixtures/server-file-app',
)

let original_CEDAR_CWD: string | undefined

beforeAll(() => {
  original_CEDAR_CWD = process.env.CEDAR_CWD
})

afterAll(() => {
  process.env.CEDAR_CWD = original_CEDAR_CWD
})

describe('apiDistServerFileExists / apiDistServerFilePath', () => {
  it('is false for a project with no api/dist/server.js', () => {
    process.env.CEDAR_CWD = NO_SERVER_FILE_FIXTURE

    expect(apiDistServerFileExists()).toBe(false)
  })

  it('is true for a project with a built server file, at the dist path', () => {
    process.env.CEDAR_CWD = SERVER_FILE_FIXTURE

    expect(apiDistServerFileExists()).toBe(true)
    expect(apiDistServerFilePath()).toBe(
      path.join(SERVER_FILE_FIXTURE, 'api/dist/server.js'),
    )
  })
})

describe('runApiDistServerFile', () => {
  let argsFile: string

  beforeAll(() => {
    process.env.CEDAR_CWD = SERVER_FILE_FIXTURE
    argsFile = path.join(os.tmpdir(), `serverFile-args-${process.pid}.json`)
    process.env.TEST_SERVER_FILE_ARGS_FILE = argsFile
  })

  afterAll(() => {
    delete process.env.TEST_SERVER_FILE_ARGS_FILE
    fs.rmSync(argsFile, { force: true })
  })

  afterEach(() => {
    delete process.env.TEST_SERVER_FILE_EXIT_CODE
    fs.rmSync(argsFile, { force: true })
  })

  it('resolves when the server file exits 0', async () => {
    await expect(runApiDistServerFile()).resolves.toBeUndefined()
  })

  it('passes apiRootPath and apiPort through as CLI args', async () => {
    await runApiDistServerFile({ apiRootPath: '/custom', port: 9999 })

    const args = JSON.parse(fs.readFileSync(argsFile, 'utf-8'))
    expect(args).toEqual(['--apiRootPath', '/custom', '--apiPort', '9999'])
  })

  it('defaults apiRootPath to "/" and omits apiPort when not given', async () => {
    await runApiDistServerFile()

    const args = JSON.parse(fs.readFileSync(argsFile, 'utf-8'))
    expect(args).toEqual(['--apiRootPath', '/'])
  })

  it('forwards an explicit port 0, rather than treating it as not given', async () => {
    // `0` means "ask the OS for a free port" — a real, valid value, and
    // falsy, so a truthy check on `options.port` would drop it silently.
    await runApiDistServerFile({ port: 0 })

    const args = JSON.parse(fs.readFileSync(argsFile, 'utf-8'))
    expect(args).toEqual(['--apiRootPath', '/', '--apiPort', '0'])
  })

  it('rejects when the server file exits non-zero', async () => {
    process.env.TEST_SERVER_FILE_EXIT_CODE = '17'

    await expect(runApiDistServerFile()).rejects.toThrow(
      'api/dist/server.js exited with code 17',
    )
  })
})
