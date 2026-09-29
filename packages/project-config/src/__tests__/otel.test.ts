import fs from 'node:fs'
import path from 'node:path'

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'

import { getOTelImportArgs } from '../otel'
import { getPaths } from '../paths'

const CEDAR_CWD = process.env.CEDAR_CWD

const FIXTURE_BASEDIR = path.join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '__fixtures__',
  'empty-project',
)

const SETUP_FILE = path.join(
  getPaths(FIXTURE_BASEDIR).api.dist,
  'opentelemetry.js',
)

beforeEach(() => {
  process.env.CEDAR_CWD = FIXTURE_BASEDIR
})

afterEach(() => {
  process.env.CEDAR_CWD = CEDAR_CWD
  fs.rmSync(path.dirname(SETUP_FILE), { recursive: true, force: true })
})

describe('getOTelImportArgs', () => {
  it('returns nothing when opentelemetry is disabled', () => {
    expect(getOTelImportArgs()).toEqual([])
  })

  it('returns an --import arg for the built setup file when enabled and present', () => {
    fs.mkdirSync(path.dirname(SETUP_FILE), { recursive: true })
    fs.writeFileSync(SETUP_FILE, '')

    const configPath = path.join(FIXTURE_BASEDIR, 'redwood.toml')
    const originalConfig = fs.readFileSync(configPath, 'utf-8')
    try {
      fs.writeFileSync(
        configPath,
        originalConfig.concat(
          '\n[experimental.opentelemetry]\n\tenabled = true\n\twrapApi = true\n',
        ),
      )

      expect(getOTelImportArgs()).toEqual([`--import=${SETUP_FILE}`])
    } finally {
      fs.writeFileSync(configPath, originalConfig)
    }
  })

  it('warns and returns nothing when the setup file is missing', () => {
    const configPath = path.join(FIXTURE_BASEDIR, 'redwood.toml')
    const originalConfig = fs.readFileSync(configPath, 'utf-8')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      fs.writeFileSync(
        configPath,
        originalConfig.concat(
          '\n[experimental.opentelemetry]\n\tenabled = true\n\twrapApi = true\n',
        ),
      )

      expect(getOTelImportArgs()).toEqual([])
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('opentelemetry.js'),
      )
    } finally {
      fs.writeFileSync(configPath, originalConfig)
      warn.mockRestore()
    }
  })
})
