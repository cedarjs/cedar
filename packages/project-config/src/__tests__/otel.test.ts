import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'

import {
  getOTelImportArgs,
  getOTelSetupFileUrl,
  quoteOTelImportArgs,
} from '../otel'
import { getPaths } from '../paths'

const CEDAR_CWD = process.env.CEDAR_CWD

// The fixture is copied to a temp dir for every test: this suite rewrites
// the config (to enable OpenTelemetry) and creates `api/dist`, and other
// packages' test suites use the checked-in fixture too, so it must never be
// modified in place.
let FIXTURE_BASEDIR: string

let SETUP_FILE: string
let CONFIG_FILE: string

beforeEach(() => {
  FIXTURE_BASEDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cedar-otel-'))

  fs.cpSync(
    path.join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      '__fixtures__',
      'empty-project',
    ),
    FIXTURE_BASEDIR,
    { recursive: true },
  )

  SETUP_FILE = path.join(getPaths(FIXTURE_BASEDIR).api.dist, 'opentelemetry.js')
  CONFIG_FILE = path.join(FIXTURE_BASEDIR, 'redwood.toml')

  process.env.CEDAR_CWD = FIXTURE_BASEDIR
})

afterEach(() => {
  if (CEDAR_CWD === undefined) {
    delete process.env.CEDAR_CWD
  } else {
    process.env.CEDAR_CWD = CEDAR_CWD
  }
  fs.rmSync(FIXTURE_BASEDIR, { recursive: true, force: true })
})

const enableOTelInConfig = () => {
  fs.writeFileSync(
    CONFIG_FILE,
    fs
      .readFileSync(CONFIG_FILE, 'utf-8')
      .concat(
        '\n[experimental.opentelemetry]\n\tenabled = true\n\twrapApi = true\n',
      ),
  )
}

describe('getOTelImportArgs', () => {
  it('returns nothing when opentelemetry is disabled', () => {
    expect(getOTelImportArgs()).toEqual([])
  })

  it('returns an --import arg for the built setup file when enabled and present', () => {
    fs.mkdirSync(path.dirname(SETUP_FILE), { recursive: true })
    fs.writeFileSync(SETUP_FILE, '')
    enableOTelInConfig()

    expect(getOTelImportArgs()).toEqual([
      `--import=${pathToFileURL(SETUP_FILE).href}`,
    ])
  })

  it('warns and returns nothing when the setup file is missing', () => {
    enableOTelInConfig()

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      expect(getOTelImportArgs()).toEqual([])
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('opentelemetry.js'),
      )
    } finally {
      warn.mockRestore()
    }
  })

  it('returns nothing when there is no Cedar project config file', () => {
    // A directory without a cedar.toml/redwood.toml is "not a Cedar
    // project": that's a normal situation for the launchers that call this
    // (they also run from inside framework packages' own test suites), not
    // an error.
    const NOT_A_PROJECT = fs.mkdtempSync(
      path.join(os.tmpdir(), 'cedar-no-config-'),
    )

    process.env.CEDAR_CWD = NOT_A_PROJECT

    try {
      expect(getOTelImportArgs()).toEqual([])
      expect(getOTelSetupFileUrl()).toBeUndefined()
    } finally {
      fs.rmSync(NOT_A_PROJECT, { recursive: true, force: true })
    }
  })

  it('lets a config file that fails to parse surface the error', () => {
    // A broken cedar.toml (syntax error, broken env interpolation) must not
    // silently disable OpenTelemetry: the parse error should propagate.
    fs.writeFileSync(CONFIG_FILE, 'this is not [valid toml')

    expect(() => getOTelImportArgs()).toThrow(/Could not parse/)
  })
})

describe('getOTelSetupFileUrl', () => {
  it('returns the setup file URL when enabled and present', () => {
    fs.mkdirSync(path.dirname(SETUP_FILE), { recursive: true })
    fs.writeFileSync(SETUP_FILE, '')
    enableOTelInConfig()

    expect(getOTelSetupFileUrl()).toBe(pathToFileURL(SETUP_FILE).href)
  })

  it('returns undefined when opentelemetry is disabled', () => {
    expect(getOTelSetupFileUrl()).toBeUndefined()
  })
})

describe('quoteOTelImportArgs', () => {
  it('single-quotes each argument for POSIX shells', () => {
    expect(quoteOTelImportArgs(['--import=file:///a/b.js'], 'darwin')).toEqual([
      `'--import=file:///a/b.js'`,
    ])
  })

  it('escapes single quotes in the argument for POSIX shells', () => {
    // A project directory such as "O'Brien" keeps its apostrophe in the
    // file URL, which would close a plain single-quoted argument.
    expect(
      quoteOTelImportArgs([`--import=file:///a/O'Brien/b.js`], 'linux'),
    ).toEqual(["'--import=file:///a/O'\\''Brien/b.js'"])
  })

  it('double-quotes each argument for Windows cmd.exe', () => {
    // cmd.exe treats single quotes as literal characters, not quoting.
    expect(quoteOTelImportArgs(['--import=file:///a/b.js'], 'win32')).toEqual([
      `"--import=file:///a/b.js"`,
    ])
  })

  it('returns the empty list unchanged', () => {
    expect(quoteOTelImportArgs([], 'darwin')).toEqual([])
    expect(quoteOTelImportArgs([], 'win32')).toEqual([])
  })
})
