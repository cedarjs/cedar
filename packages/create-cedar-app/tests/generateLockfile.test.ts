import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, expect, test } from 'vitest'

import { generateLockfile } from '../scripts/generateLockfile.js'

// Stands in for `yarn`/`npm install`/`pnpm install`. It records what the
// compose dir contained when the install ran (directory entries and the
// lockfile's content) and writes a fresh lockfile, like a real install would
const STUB_INSTALL_SCRIPT = `
  const fs = require('node:fs')
  fs.writeFileSync(
    process.env.REPORT_FILE,
    JSON.stringify({
      entries: fs.readdirSync('.').sort(),
      lockfileContent: fs.readFileSync(process.env.LOCKFILE_NAME, 'utf-8'),
    }),
  )
  fs.writeFileSync(process.env.LOCKFILE_NAME, 'freshly generated lockfile')
`

const LOCKFILE_NAMES = ['yarn.lock', 'package-lock.json', 'pnpm-lock.yaml']

let testDir: string
let templateDir: string
let overlayDir: string
let reportFile: string

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cedar-lockfile-test-'))
  templateDir = path.join(testDir, 'template')
  overlayDir = path.join(testDir, 'overlay')
  reportFile = path.join(testDir, 'report.json')

  fs.mkdirSync(path.join(templateDir, 'web'), { recursive: true })
  fs.writeFileSync(
    path.join(templateDir, 'package.json'),
    '{ "name": "template" }',
  )
  fs.writeFileSync(path.join(templateDir, 'web', 'index.html'), '<html></html>')
  fs.mkdirSync(path.join(templateDir, 'node_modules'), { recursive: true })

  fs.mkdirSync(overlayDir, { recursive: true })
  fs.writeFileSync(
    path.join(overlayDir, 'package.json'),
    '{ "name": "overlay" }',
  )
})

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true })
})

test.each(LOCKFILE_NAMES)(
  'regenerates %s even when the overlay carries a stale one',
  async (lockfileName) => {
    // The situation on a patch release branch: the previous release committed
    // its generated lockfiles into the overlay dirs
    for (const staleLockfileName of LOCKFILE_NAMES) {
      fs.writeFileSync(
        path.join(overlayDir, staleLockfileName),
        'stale lockfile from the previous release',
      )
    }

    const lockDest = await generateLockfile(
      templateDir,
      overlayDir,
      lockfileName,
      'node',
      ['-e', STUB_INSTALL_SCRIPT],
      { REPORT_FILE: reportFile, LOCKFILE_NAME: lockfileName },
    )

    const report = JSON.parse(fs.readFileSync(reportFile, 'utf-8'))

    // The stale lockfiles never made it into the compose dir: the install
    // only saw the empty placeholder for the lockfile it generates
    expect(report.lockfileContent).toBe('')
    expect(report.entries).toEqual(['package.json', lockfileName, 'web'].sort())

    // The overlay's package.json replaced the template's
    // and the generated lockfile was copied back into the overlay dir
    expect(lockDest).toBe(path.join(overlayDir, lockfileName))
    expect(fs.readFileSync(lockDest, 'utf-8')).toBe(
      'freshly generated lockfile',
    )
  },
)

test('excludes install artifacts from the template copy', async () => {
  fs.mkdirSync(path.join(templateDir, '.yarn'), { recursive: true })
  fs.writeFileSync(path.join(templateDir, 'yarn.lock'), 'stale template lock')

  await generateLockfile(
    templateDir,
    overlayDir,
    'yarn.lock',
    'node',
    ['-e', STUB_INSTALL_SCRIPT],
    { REPORT_FILE: reportFile, LOCKFILE_NAME: 'yarn.lock' },
  )

  const report = JSON.parse(fs.readFileSync(reportFile, 'utf-8'))

  expect(report.lockfileContent).toBe('')
  expect(report.entries).toEqual(['package.json', 'web', 'yarn.lock'].sort())
})
